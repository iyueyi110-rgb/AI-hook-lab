import { randomUUID } from "node:crypto";

import {
  applyStrategyAction,
  StrategyTransitionError,
  type StrategyAction,
  type StrategyActionInput,
} from "./domain.ts";
import { activationReadiness, classifyStrategyEvidence } from "./evidence.ts";
import { getStrategyRepository, type StrategyRepository } from "./repository.ts";
import type {
  CreativeStrategyAssignment,
  StrategyCard,
  StrategyCardRef,
  StrategyContent,
  StrategyEvidence,
  StrategyFit,
  StrategyNotApplicableReason,
  StrategyReview,
  StrategyScopePair,
  StrategyStoreState,
  StrategyEvaluationSnapshot,
  StrategyVersion,
} from "./types.ts";
import {
  computeStrategyContentHash,
  strategyContentFromStored,
  validateStrategyContent,
} from "./validation.ts";

export class StrategyNotFoundError extends Error {}
export class StrategyConflictError extends Error {}
export class StrategyInputError extends Error {}

function pairKey(pair: StrategyScopePair): string {
  return `${pair.platform}:${pair.contentType}`;
}

function samePair(left: StrategyScopePair, right: StrategyScopePair): boolean {
  return pairKey(left) === pairKey(right);
}

function review(
  version: StrategyVersion,
  action: StrategyReview["action"],
  actorId: string,
  now: Date,
  reason?: string,
): StrategyReview {
  return {
    id: randomUUID(),
    cardId: version.cardId,
    strategyVersion: version.version,
    action,
    actorId,
    ...(reason?.trim() ? { reason: reason.trim().slice(0, 500) } : {}),
    contentHash: version.contentHash,
    createdAt: now.toISOString(),
  };
}

export interface ActiveStrategyView {
  id: string;
  version: number;
  title: string;
  scopePairs: StrategyScopePair[];
  audienceLabel?: string;
  guidance: StrategyVersion["guidance"];
  activatedAt: string;
  expiresAt: string;
  evidenceUpdatedAt: string;
}

export class StrategyService {
  private readonly repository: StrategyRepository;
  private readonly now: () => Date;
  constructor(
    repository: StrategyRepository = getStrategyRepository(),
    now: () => Date = () => new Date(),
  ) {
    this.repository = repository;
    this.now = now;
  }

  async createDraft(actorId: string, input: unknown): Promise<{ card: StrategyCard; version: StrategyVersion }> {
    const content = validateStrategyContent(input);
    const now = this.now();
    const timestamp = now.toISOString();
    return this.repository.transaction((state) => {
      const card: StrategyCard = {
        id: randomUUID(),
        currentVersion: 1,
        createdBy: actorId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const version: StrategyVersion = {
        ...content,
        cardId: card.id,
        version: 1,
        revision: 0,
        status: "draft",
        contentHash: computeStrategyContentHash(content),
        createdBy: actorId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.cards.push(card);
      state.versions.push(version);
      state.reviews.push(review(version, "created", actorId, now));
      return { card: structuredClone(card), version: structuredClone(version) };
    });
  }

  async list(): Promise<Array<{
    card: StrategyCard;
    versions: StrategyVersion[];
    evidence: StrategyEvidence[];
    readiness: Record<number, ReturnType<typeof activationReadiness>>;
  }>> {
    const state = await this.repository.read();
    return state.cards.map((card) => ({
      card,
      versions: state.versions
        .filter((version) => version.cardId === card.id)
        .sort((a, b) => b.version - a.version),
      evidence: state.evidence.filter((item) => item.cardId === card.id),
      readiness: Object.fromEntries(
        state.versions
          .filter((version) => version.cardId === card.id)
          .map((version) => [
            version.version,
            activationReadiness(version, state.evidence, this.now()),
          ]),
      ),
    }));
  }

  async get(cardId: string, version: number): Promise<{
    card: StrategyCard;
    version: StrategyVersion;
    evidence: StrategyEvidence[];
    reviews: StrategyReview[];
  }> {
    const state = await this.repository.read();
    const card = state.cards.find((item) => item.id === cardId);
    const current = state.versions.find((item) => item.cardId === cardId && item.version === version);
    if (!card || !current) throw new StrategyNotFoundError("strategy_not_found");
    return {
      card: structuredClone(card),
      version: structuredClone(current),
      evidence: structuredClone(state.evidence.filter((item) => item.cardId === cardId && item.strategyVersion === version)),
      reviews: structuredClone(state.reviews.filter((item) => item.cardId === cardId && item.strategyVersion === version)),
    };
  }

  async updateDraft(
    cardId: string,
    version: number,
    actorId: string,
    expectedRevision: number,
    input: unknown,
  ): Promise<StrategyVersion> {
    const content = validateStrategyContent(input);
    const now = this.now();
    return this.repository.transaction((state) => {
      const index = state.versions.findIndex((item) => item.cardId === cardId && item.version === version);
      if (index < 0) throw new StrategyNotFoundError("strategy_not_found");
      const current = state.versions[index]!;
      if (current.status !== "draft") throw new StrategyConflictError("strategy_immutable");
      if (current.revision !== expectedRevision) throw new StrategyConflictError("revision_conflict");
      const next: StrategyVersion = {
        ...current,
        ...content,
        contentHash: computeStrategyContentHash(content),
        revision: current.revision + 1,
        updatedAt: now.toISOString(),
      };
      state.versions[index] = next;
      state.reviews.push(review(next, "updated", actorId, now));
      return structuredClone(next);
    });
  }

  async action(
    cardId: string,
    version: number,
    actorId: string,
    input: StrategyActionInput,
  ): Promise<StrategyVersion> {
    const now = this.now();
    return this.repository.transaction((state) => {
      const index = state.versions.findIndex((item) => item.cardId === cardId && item.version === version);
      if (index < 0) throw new StrategyNotFoundError("strategy_not_found");
      try {
        const result = applyStrategyAction(state.versions[index]!, { ...input, actorId } as StrategyAction, state.evidence, now);
        if (input.action === "activate") {
          for (let i = 0; i < state.versions.length; i += 1) {
            const old = state.versions[i]!;
            if (old.cardId === cardId && old.version !== version && old.status === "active") {
              const archived = {
                ...old,
                status: "archived" as const,
                revision: old.revision + 1,
                archivedAt: now.toISOString(),
                updatedAt: now.toISOString(),
              };
              state.versions[i] = archived;
              state.reviews.push(review(archived, "archive", actorId, now, "激活新版本时自动归档"));
            }
          }
        }
        state.versions[index] = result.version;
        state.reviews.push(result.review);
        return structuredClone(result.version);
      } catch (error) {
        if (error instanceof StrategyTransitionError && error.code === "revision_conflict") {
          throw new StrategyConflictError(error.code);
        }
        throw error;
      }
    });
  }

  async clone(cardId: string, sourceVersion: number, actorId: string): Promise<StrategyVersion> {
    const now = this.now();
    return this.repository.transaction((state) => {
      const card = state.cards.find((item) => item.id === cardId);
      const source = state.versions.find((item) => item.cardId === cardId && item.version === sourceVersion);
      if (!card || !source) throw new StrategyNotFoundError("strategy_not_found");
      const nextVersion = Math.max(...state.versions.filter((item) => item.cardId === cardId).map((item) => item.version)) + 1;
      const content: StrategyContent = validateStrategyContent(source);
      const next: StrategyVersion = {
        ...content,
        cardId,
        version: nextVersion,
        revision: 0,
        status: "draft",
        contentHash: computeStrategyContentHash(content),
        createdBy: actorId,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      card.currentVersion = nextVersion;
      card.updatedAt = now.toISOString();
      state.versions.push(next);
      state.reviews.push(review(next, "clone", actorId, now, `从 v${sourceVersion} 克隆`));
      return structuredClone(next);
    });
  }

  async recordEvidence(
    actorId: string,
    input: Omit<StrategyEvidence, "id" | "eligibility" | "caveats">,
  ): Promise<StrategyEvidence> {
    const classification = classifyStrategyEvidence(input);
    return this.repository.transaction((state) => {
      const version = state.versions.find((item) => item.cardId === input.cardId && item.version === input.strategyVersion);
      if (!version) throw new StrategyNotFoundError("strategy_not_found");
      const existing = input.sourceId
        ? state.evidence.find(
            (item) =>
              item.cardId === input.cardId
              && item.strategyVersion === input.strategyVersion
              && item.sourceId === input.sourceId,
          )
        : undefined;
      if (existing) return structuredClone(existing);
      const evidence: StrategyEvidence = {
        ...input,
        id: randomUUID(),
        eligibility: classification.eligibility,
        caveats: classification.caveats,
      };
      state.evidence.push(evidence);
      state.reviews.push(review(version, "updated", actorId, this.now(), `新增 ${input.origin} 证据`));
      return structuredClone(evidence);
    });
  }

  async recordEvaluation(actorId: string, evaluation: StrategyEvaluationSnapshot): Promise<StrategyEvidence> {
    const detail = await this.get(evaluation.candidateStrategyRef.id, evaluation.candidateStrategyRef.version);
    if (!["approved_experiment", "archived"].includes(detail.version.status)) {
      throw new StrategyConflictError("strategy_not_approved_for_evaluation");
    }
    if (!detail.version.scopePairs.some((pair) => samePair(pair, evaluation.scopePair))) {
      throw new StrategyInputError("strategy_scope_mismatch");
    }
    const collectedAt = evaluation.completedAt ?? this.now().toISOString();
    return this.recordEvidence(actorId, {
      cardId: detail.card.id,
      strategyVersion: detail.version.version,
      origin: "evaluation_set",
      sampleSize: evaluation.caseCount,
      sourceId: `strategy-evaluation:${evaluation.evaluationRunId ?? randomUUID()}`,
      scopePair: evaluation.scopePair,
      evaluation: structuredClone(evaluation),
      collectedAt,
    });
  }

  async listActive(scope: StrategyScopePair, now = this.now()): Promise<ActiveStrategyView[]> {
    if (this.repository.readActive) {
      return (await this.repository.readActive(scope, now)).map(({ version, evidenceUpdatedAt }) => ({
        id: version.cardId,
        version: version.version,
        title: version.title,
        scopePairs: structuredClone(version.scopePairs),
        ...(version.audienceLabel ? { audienceLabel: version.audienceLabel } : {}),
        guidance: structuredClone(version.guidance),
        activatedAt: version.activatedAt!,
        expiresAt: version.expiresAt!,
        evidenceUpdatedAt,
      }));
    }
    const state = await this.repository.read();
    return state.versions
      .filter((version) =>
        version.status === "active" &&
        Boolean(version.activatedAt && version.expiresAt) &&
        Date.parse(version.expiresAt!) > now.getTime() &&
        version.scopePairs.some((pair) => samePair(pair, scope)),
      )
      .sort((a, b) => {
        const aEvidence = Math.max(0, ...state.evidence.filter((item) => item.cardId === a.cardId && item.strategyVersion === a.version).map((item) => Date.parse(item.collectedAt)));
        const bEvidence = Math.max(0, ...state.evidence.filter((item) => item.cardId === b.cardId && item.strategyVersion === b.version).map((item) => Date.parse(item.collectedAt)));
        return bEvidence - aEvidence || b.activatedAt!.localeCompare(a.activatedAt!) || a.cardId.localeCompare(b.cardId);
      })
      .slice(0, 5)
      .map((version) => ({
        id: version.cardId,
        version: version.version,
        title: version.title,
        scopePairs: structuredClone(version.scopePairs),
        ...(version.audienceLabel ? { audienceLabel: version.audienceLabel } : {}),
        guidance: structuredClone(version.guidance),
        activatedAt: version.activatedAt!,
        expiresAt: version.expiresAt!,
        evidenceUpdatedAt: state.evidence
          .filter(
            (item) =>
              item.cardId === version.cardId
              && item.strategyVersion === version.version,
          )
          .map((item) => item.collectedAt)
          .sort()
          .at(-1) ?? version.activatedAt!,
      }));
  }

  async bindActive(
    runId: string,
    reference: StrategyCardRef,
    scope: StrategyScopePair,
    now = this.now(),
  ): Promise<CreativeStrategyAssignment> {
    const transaction = this.repository.bindingTransaction
      ? <T>(mutator: (state: StrategyStoreState) => T | Promise<T>) =>
          this.repository.bindingTransaction!(runId, reference.id, reference.version, mutator)
      : <T>(mutator: (state: StrategyStoreState) => T | Promise<T>) =>
          this.repository.transaction(mutator);
    return transaction((state) => {
      if (state.assignments.some((item) => item.runId === runId)) throw new StrategyConflictError("strategy_already_bound");
      const version = state.versions.find((item) => item.cardId === reference.id && item.version === reference.version);
      if (!version) throw new StrategyNotFoundError("strategy_not_found");
      const content = strategyContentFromStored(version);
      if (computeStrategyContentHash(content) !== version.contentHash) throw new StrategyConflictError("strategy_hash_mismatch");
      if (version.status !== "active") throw new StrategyConflictError("strategy_not_active");
      if (!version.expiresAt || Date.parse(version.expiresAt) <= now.getTime()) throw new StrategyConflictError("strategy_expired");
      if (!version.scopePairs.some((pair) => samePair(pair, scope))) throw new StrategyConflictError("strategy_scope_mismatch");
      const assignment: CreativeStrategyAssignment = {
        runId,
        cardId: reference.id,
        strategyVersion: reference.version,
        appliedGuidanceHash: version.contentHash,
        boundAt: now.toISOString(),
      };
      state.assignments.push(assignment);
      return structuredClone(assignment);
    });
  }

  async getAssignment(runId: string): Promise<CreativeStrategyAssignment | undefined> {
    return structuredClone((await this.repository.read()).assignments.find((item) => item.runId === runId));
  }

  async unbind(runId: string): Promise<void> {
    await this.repository.transaction((state) => {
      const index = state.assignments.findIndex((item) => item.runId === runId);
      if (index >= 0 && !state.assignments[index]!.feedbackAt) state.assignments.splice(index, 1);
    });
  }

  async resolveApplied(runId: string): Promise<{ assignment: CreativeStrategyAssignment; version: StrategyVersion } | undefined> {
    const state = await this.repository.read();
    const assignment = state.assignments.find((item) => item.runId === runId);
    if (!assignment) return undefined;
    const version = state.versions.find((item) => item.cardId === assignment.cardId && item.version === assignment.strategyVersion);
    if (!version || version.contentHash !== assignment.appliedGuidanceHash) throw new StrategyConflictError("strategy_hash_mismatch");
    strategyContentFromStored(version);
    return { assignment: structuredClone(assignment), version: structuredClone(version) };
  }

  async recordFeedback(
    runId: string,
    fit: StrategyFit,
    reason?: StrategyNotApplicableReason,
  ): Promise<CreativeStrategyAssignment> {
    if (!["helpful", "unhelpful", "not_applicable"].includes(fit)) throw new StrategyInputError("strategy_fit_invalid");
    if (fit === "not_applicable" && !reason) throw new StrategyInputError("strategy_reason_required");
    if (fit !== "not_applicable" && reason) throw new StrategyInputError("strategy_reason_not_allowed");
    return this.repository.transaction((state) => {
      const index = state.assignments.findIndex((item) => item.runId === runId);
      if (index < 0) throw new StrategyNotFoundError("strategy_assignment_not_found");
      const next: CreativeStrategyAssignment = {
        ...state.assignments[index]!,
        strategyFit: fit,
        ...(reason ? { notApplicableReason: reason } : {}),
        feedbackAt: this.now().toISOString(),
      };
      if (!reason) delete next.notApplicableReason;
      state.assignments[index] = next;
      return structuredClone(next);
    });
  }

  async diff(cardId: string, version: number, against: number): Promise<Record<string, { before: unknown; after: unknown }>> {
    const state = await this.repository.read();
    const before = state.versions.find((item) => item.cardId === cardId && item.version === against);
    const after = state.versions.find((item) => item.cardId === cardId && item.version === version);
    if (!before || !after) throw new StrategyNotFoundError("strategy_not_found");
    const result: Record<string, { before: unknown; after: unknown }> = {};
    for (const key of ["title", "scopePairs", "audienceLabel", "guidance", "hypothesis"] as const) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) result[key] = { before: before[key], after: after[key] };
    }
    return result;
  }
}

let service: StrategyService | undefined;
export function getStrategyService(): StrategyService {
  service ??= new StrategyService();
  return service;
}

export function strategyStateWithoutContent(state: StrategyStoreState): Pick<StrategyStoreState, "schemaVersion"> {
  return { schemaVersion: state.schemaVersion };
}
