import { createHash, randomInt, randomUUID } from "node:crypto";

import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from "./auth.ts";
import { buildEvaluationReport } from "./metrics.ts";
import type { EvaluationRepository } from "./repository.ts";
import type {
  AdjudicationRecord,
  BadCaseRecord,
  BadCaseSeverity,
  EvaluationCandidate,
  EvaluationCase,
  EvaluationReport,
  EvaluationRunRecord,
  EvaluationState,
  EvaluationUser,
  HumanEvaluationRecord,
  PairwiseEvaluationRecord,
  PairwiseWinner,
  PromptRole,
  UserRole,
} from "./types.ts";
import { BAD_CASE_TYPES } from "./types.ts";

export interface GeneratedEvaluationHook {
  content: string;
  styleTag: string;
  recommendReason: string;
  modelScore?: number;
}

export interface EvaluationGenerationProvider {
  generate(input: {
    evaluationCase: EvaluationCase;
    promptRole: PromptRole;
    promptContent: string;
    modelName: string;
    modelParameters: Record<string, unknown>;
    executionMode: "live" | "mock";
  }): Promise<{ hooks: GeneratedEvaluationHook[]; rawResponse?: unknown }>;
}

interface CreateRunInput {
  runName: string;
  executionMode: "live" | "mock";
  evaluatorIds: [string, string];
  adjudicatorId: string;
  modelName: string;
  modelParameters: Record<string, unknown>;
  caseIds?: string[];
  baselinePromptId?: string;
  candidatePromptId?: string;
}

interface ReviewInput {
  usabilityScore: number;
  platformFitScore: number;
  attractivenessScore: number;
  reasonQualityScore: number;
  favoriteIntent: boolean;
  adoptionIntent: boolean;
  evaluatorNote?: string;
  badCases: Array<{ type: string; severity: BadCaseSeverity; description?: string }>;
}

export class EvaluationService {
  private readonly repository: EvaluationRepository;
  private readonly provider: EvaluationGenerationProvider;
  private initialization?: Promise<void>;

  constructor(repository: EvaluationRepository, provider: EvaluationGenerationProvider = defaultProvider) {
    this.repository = repository;
    this.provider = provider;
  }

  async initialize(): Promise<void> {
    this.initialization ??= this.repository.initialize();
    await this.initialization;
  }

  async getState(): Promise<EvaluationState> {
    await this.initialize();
    return this.repository.read();
  }

  async setupFirstAdmin(username: string, displayName: string, password: string): Promise<EvaluationUser> {
    await this.initialize();
    return this.repository.transaction(async (state) => {
      if (state.users.length) throw new Error("Initial admin already exists");
      return addUser(state, { username, displayName, password, role: "admin" });
    });
  }

  async createUser(actorId: string, input: { username: string; displayName: string; password: string; role: UserRole }): Promise<EvaluationUser> {
    return this.repository.transaction(async (state) => {
      requireRole(state, actorId, "admin");
      const user = await addUser(state, input);
      audit(state, "user.created", actorId, { userId: user.id, role: user.role });
      return user;
    });
  }

  async updateUser(actorId: string, userId: string, input: { status?: "active" | "disabled"; password?: string }): Promise<EvaluationUser> {
    return this.repository.transaction(async (state) => {
      requireRole(state, actorId, "admin");
      const user = state.users.find((item) => item.id === userId);
      if (!user) throw new Error("User not found");
      if (user.id === actorId && input.status === "disabled") throw new Error("Admin cannot disable their own account");
      if (input.status) user.status = input.status;
      if (input.password) {
        const digest = await hashPassword(input.password);
        user.passwordHash = digest.hash;
        user.passwordSalt = digest.salt;
      }
      user.updatedAt = new Date().toISOString();
      if (input.status === "disabled" || input.password) state.sessions = state.sessions.filter((item) => item.userId !== user.id);
      audit(state, "user.updated", actorId, { userId, status: input.status, passwordReset: Boolean(input.password) });
      return structuredClone(user);
    });
  }

  async authenticate(username: string, password: string): Promise<{ user: EvaluationUser; token: string; expiresAt: string }> {
    return this.repository.transaction(async (state) => {
      const user = state.users.find((item) => item.username.toLowerCase() === username.trim().toLowerCase());
      if (!user || user.status !== "active") throw new Error("用户名或密码错误");
      if (user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) throw new Error("账号暂时锁定，请稍后重试");
      const valid = await verifyPassword(password, { hash: user.passwordHash, salt: user.passwordSalt });
      if (!valid) {
        user.failedLoginCount += 1;
        if (user.failedLoginCount >= 5) {
          user.lockedUntil = new Date(Date.now() + 15 * 60_000).toISOString();
          user.failedLoginCount = 0;
        }
        throw new Error("用户名或密码错误");
      }
      user.failedLoginCount = 0;
      delete user.lockedUntil;
      const { token, tokenHash } = createSessionToken();
      const expiresAt = new Date(Date.now() + 12 * 60 * 60_000).toISOString();
      state.sessions.push({ id: randomUUID(), userId: user.id, tokenHash, expiresAt, createdAt: new Date().toISOString() });
      audit(state, "session.created", user.id);
      return { user, token, expiresAt };
    });
  }

  async resolveSession(token: string): Promise<EvaluationUser | null> {
    const state = await this.getState();
    const digest = hashSessionToken(token);
    const session = state.sessions.find((item) => item.tokenHash === digest && Date.parse(item.expiresAt) > Date.now());
    if (!session) return null;
    return state.users.find((item) => item.id === session.userId && item.status === "active") ?? null;
  }

  async logout(token: string): Promise<void> {
    await this.repository.transaction((state) => {
      state.sessions = state.sessions.filter((item) => item.tokenHash !== hashSessionToken(token));
    });
  }

  async createRun(actorId: string, input: CreateRunInput): Promise<EvaluationRunRecord> {
    return this.repository.transaction((state) => {
      requireRole(state, actorId, "admin");
      if (new Set(input.evaluatorIds).size !== 2) throw new Error("Exactly two different evaluators are required");
      input.evaluatorIds.forEach((id) => requireRole(state, id, "evaluator"));
      requireRole(state, input.adjudicatorId, "adjudicator");
      if (input.evaluatorIds.includes(input.adjudicatorId)) throw new Error("Adjudicator cannot be a primary evaluator");
      if (input.executionMode === "live" && !process.env.DEEPSEEK_API_KEY) throw new Error("Live evaluation requires DEEPSEEK_API_KEY");
      const baseline = state.promptVersions.find((item) => item.id === (input.baselinePromptId ?? "prompt-v1.0"));
      const candidate = state.promptVersions.find((item) => item.id === (input.candidatePromptId ?? "prompt-v1.1"));
      if (!baseline || !candidate) throw new Error("Prompt version not found");
      if (baseline.id === candidate.id || baseline.role !== "baseline" || candidate.role !== "candidate") throw new Error("Run requires distinct baseline and candidate Prompt roles");
      const selectedIds = input.caseIds ? new Set(input.caseIds) : null;
      const cases = state.cases.filter((item) => item.status === "active" && (!selectedIds || selectedIds.has(item.caseId)));
      if (!cases.length) throw new Error("At least one evaluation case is required");
      const now = new Date().toISOString();
      const id = randomUUID();
      const generationTasks = cases.flatMap((item) => (["baseline", "candidate"] as const).map((promptRole) => ({
        id: `${id}:${item.caseId}:${promptRole}`,
        caseId: item.caseId,
        promptRole,
        firstAttemptFormatError: false,
        terminalStatus: "pending" as const,
        attemptCount: 0,
        rawResponses: [],
      })));
      const reviewAssignments = input.evaluatorIds.flatMap((evaluatorId) => cases.map((item) => {
        const baselineFirst = randomInt(2) === 0;
        return {
          id: randomUUID(), runId: id, caseId: item.caseId, evaluatorId,
          optionA: (baselineFirst ? "baseline" : "candidate") as PromptRole,
          optionB: (baselineFirst ? "candidate" : "baseline") as PromptRole,
          createdAt: now,
        };
      }));
      const snapshotPayload = { cases, baseline, candidate, modelName: input.modelName, modelParameters: input.modelParameters };
      const run: EvaluationRunRecord = {
        id,
        runName: input.runName.trim() || `评测批次 ${now.slice(0, 10)}`,
        dataOrigin: "evaluation_set",
        executionMode: input.executionMode,
        status: "generating",
        caseCount: cases.length,
        datasetVersion: cases[0].datasetVersion,
        cases: structuredClone(cases),
        baselinePromptId: baseline.id,
        candidatePromptId: candidate.id,
        baselinePromptVersion: baseline.version,
        candidatePromptVersion: candidate.version,
        baselinePromptContent: baseline.promptContent,
        candidatePromptContent: candidate.promptContent,
        snapshotHash: createHash("sha256").update(JSON.stringify(snapshotPayload)).digest("hex"),
        modelName: input.modelName,
        modelParameters: structuredClone(input.modelParameters),
        evaluatorIds: input.evaluatorIds,
        adjudicatorId: input.adjudicatorId,
        generationTasks,
        candidates: [],
        formalResults: [],
        reviewAssignments,
        rawReviews: [],
        rawPairwiseEvaluations: [],
        pairwiseDecisions: [],
        adjudications: [],
        badCases: [],
        createdAt: now,
        updatedAt: now,
      };
      state.runs.push(run);
      audit(state, "run.created", actorId, { runId: id, caseCount: cases.length, executionMode: input.executionMode });
      return structuredClone(run);
    });
  }

  async createPromptVersion(actorId: string, input: {
    version: string;
    name: string;
    promptContent: string;
    changeSummary: string;
    modelName: string;
    modelParameters: Record<string, unknown>;
  }) {
    return this.repository.transaction((state) => {
      requireRole(state, actorId, "admin");
      const version = input.version.trim();
      if (!/^v\d+\.\d+(?:\.\d+)?$/.test(version)) throw new Error("Version must use v1.2 format");
      if (state.promptVersions.some((item) => item.version === version)) throw new Error("Prompt version already exists");
      const promptContent = input.promptContent.trim();
      if (!promptContent) throw new Error("Prompt content is required");
      const createdAt = new Date().toISOString();
      const prompt = {
        id: `prompt-${version}`,
        version,
        name: input.name.trim() || `${version} candidate`,
        role: "candidate" as const,
        promptContent,
        changeSummary: input.changeSummary.trim(),
        modelName: input.modelName.trim() || "deepseek-chat",
        modelParameters: structuredClone(input.modelParameters),
        contentHash: createHash("sha256").update(promptContent).digest("hex"),
        createdAt,
      };
      state.promptVersions.push(prompt);
      audit(state, "prompt.created", actorId, { promptId: prompt.id, version });
      return structuredClone(prompt);
    });
  }

  async setBaselinePrompt(actorId: string, promptId: string) {
    return this.repository.transaction((state) => {
      requireRole(state, actorId, "admin");
      const prompt = state.promptVersions.find((item) => item.id === promptId);
      if (!prompt) throw new Error("Prompt version not found");
      state.promptVersions.forEach((item) => {
        if (item.role === "baseline") item.role = "released";
      });
      prompt.role = "baseline";
      audit(state, "prompt.baseline_changed", actorId, { promptId });
      return structuredClone(prompt);
    });
  }

  async generateNext(actorId: string, runId: string): Promise<EvaluationRunRecord> {
    const state = await this.getState();
    requireRole(state, actorId, "admin");
    const run = findRun(state, runId);
    const nextCase = run.cases.find((item) => run.generationTasks.some((task) => task.caseId === item.caseId && task.terminalStatus === "pending"));
    if (!nextCase) return run;
    const generated: Array<{ taskId: string; promptRole: PromptRole; hooks?: GeneratedEvaluationHook[]; rawResponse?: unknown; error?: Error; firstFormatError: boolean; attempts: number }> = [];
    const pendingRoles = run.generationTasks.filter((item) => item.caseId === nextCase.caseId && item.terminalStatus === "pending").map((item) => item.promptRole);
    for (const promptRole of pendingRoles) {
      const task = run.generationTasks.find((item) => item.caseId === nextCase.caseId && item.promptRole === promptRole)!;
      let firstFormatError = false;
      let lastError: Error | undefined;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const response = await this.provider.generate({
            evaluationCase: nextCase,
            promptRole,
            promptContent: promptRole === "baseline" ? run.baselinePromptContent : run.candidatePromptContent,
            modelName: run.modelName,
            modelParameters: run.modelParameters,
            executionMode: run.executionMode,
          });
          validateHooks(response.hooks);
          generated.push({ taskId: task.id, promptRole, hooks: response.hooks, rawResponse: response.rawResponse, firstFormatError, attempts: attempt });
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("Generation failed");
          if (attempt === 1 && /format|JSON|3 hooks/i.test(lastError.message)) firstFormatError = true;
          if (attempt === 3) generated.push({ taskId: task.id, promptRole, error: lastError, firstFormatError, attempts: attempt });
        }
      }
    }
    return this.repository.transaction((draft) => {
      requireRole(draft, actorId, "admin");
      const current = findRun(draft, runId);
      for (const result of generated) {
        const task = current.generationTasks.find((item) => item.id === result.taskId)!;
        task.attemptCount = result.attempts;
        task.firstAttemptFormatError = result.firstFormatError;
        task.rawResponses = result.rawResponse === undefined ? [] : [result.rawResponse];
        if (result.error || !result.hooks) {
          task.terminalStatus = /format|JSON|3 hooks/i.test(result.error?.message ?? "") ? "format_error" : "generation_error";
          task.lastError = result.error?.message;
          continue;
        }
        task.terminalStatus = "success";
        result.hooks.forEach((hook, index) => {
          current.candidates.push(candidateRecord(current, nextCase, task.id, result.promptRole, hook, index));
        });
      }
      current.status = current.generationTasks.every((task) => task.terminalStatus === "success")
        ? "generated"
        : current.generationTasks.some((task) => task.terminalStatus === "format_error" || task.terminalStatus === "generation_error")
          ? "failed"
          : "generating";
      current.updatedAt = new Date().toISOString();
      audit(draft, "run.generated_step", actorId, { runId, caseId: nextCase.caseId });
      return structuredClone(current);
    });
  }

  async retryGenerationTask(actorId: string, runId: string, taskId: string): Promise<EvaluationRunRecord> {
    return this.repository.transaction((state) => {
      requireRole(state, actorId, "admin");
      const run = findRun(state, runId);
      const task = run.generationTasks.find((item) => item.id === taskId);
      if (!task || (task.terminalStatus !== "format_error" && task.terminalStatus !== "generation_error")) throw new Error("Only terminal failed tasks can be retried");
      task.terminalStatus = "pending";
      task.lastError = undefined;
      task.attemptCount = 0;
      run.status = "generating";
      run.updatedAt = new Date().toISOString();
      audit(state, "generation.retry_requested", actorId, { runId, taskId });
      return structuredClone(run);
    });
  }

  async selectCandidate(actorId: string, runId: string, candidateId: string): Promise<EvaluationRunRecord> {
    return this.repository.transaction((state) => {
      requireRole(state, actorId, "admin");
      const run = findRun(state, runId);
      const candidate = run.candidates.find((item) => item.id === candidateId);
      if (!candidate || candidate.generationStatus !== "success") throw new Error("Candidate not found");
      const previousFormal = run.formalResults.find((item) => item.caseId === candidate.caseId && item.promptRole === candidate.promptRole);
      if (previousFormal && run.rawReviews.some((item) => item.formalResultId === previousFormal.id)) throw new Error("Cannot change a candidate after human review has started");
      const sameSlot = run.candidates.filter((item) => item.caseId === candidate.caseId && item.promptRole === candidate.promptRole);
      sameSlot.forEach((item) => { item.selected = item.id === candidate.id; });
      run.formalResults = run.formalResults.filter((item) => !(item.caseId === candidate.caseId && item.promptRole === candidate.promptRole));
      const evaluationCase = run.cases.find((item) => item.caseId === candidate.caseId)!;
      run.formalResults.push({
        id: `formal:${candidate.id}`,
        caseId: candidate.caseId,
        platform: evaluationCase.platform,
        promptRole: candidate.promptRole,
        overLength: candidate.overLength,
        highSeverityBadCaseTypes: [],
        reviews: [],
      });
      run.status = run.formalResults.length === run.caseCount * 2 ? "reviewing" : "selecting";
      run.updatedAt = new Date().toISOString();
      audit(state, "candidate.selected", actorId, { runId, candidateId });
      return structuredClone(run);
    });
  }

  async submitReview(actorId: string, runId: string, formalResultId: string, input: ReviewInput, claimedEvaluatorId = actorId): Promise<EvaluationRunRecord> {
    if (claimedEvaluatorId !== actorId) throw new Error("Reviewers may only submit under their own identity");
    validateReview(input);
    return this.repository.transaction((state) => {
      requireRole(state, actorId, "evaluator");
      const run = findRun(state, runId);
      if (!run.evaluatorIds.includes(actorId)) throw new Error("Reviewer is not assigned to this run");
      const formal = run.formalResults.find((item) => item.id === formalResultId);
      if (!formal) throw new Error("Formal result not found");
      if (!run.reviewAssignments.some((item) => item.caseId === formal.caseId && item.evaluatorId === actorId)) throw new Error("Review assignment not found");
      const now = new Date().toISOString();
      const existing = run.rawReviews.find((item) => item.formalResultId === formalResultId && item.evaluatorId === actorId);
      const record: HumanEvaluationRecord = {
        id: existing?.id ?? randomUUID(), runId, formalResultId, caseId: formal.caseId,
        promptRole: formal.promptRole, evaluatorId: actorId, ...input,
        createdAt: existing?.createdAt ?? now, updatedAt: now,
      };
      run.rawReviews = run.rawReviews.filter((item) => item.id !== record.id);
      run.rawReviews.push(record);
      formal.reviews = run.rawReviews.filter((item) => item.formalResultId === formalResultId).map((item) => ({
        evaluatorId: item.evaluatorId,
        usabilityScore: item.usabilityScore,
        platformFitScore: item.platformFitScore,
        attractivenessScore: item.attractivenessScore,
        reasonQualityScore: item.reasonQualityScore,
        favoriteIntent: item.favoriteIntent,
        adoptionIntent: item.adoptionIntent,
      }));
      consolidateBadCases(run, formalResultId);
      refreshRun(run);
      audit(state, "review.submitted", actorId, { runId, formalResultId });
      return structuredClone(run);
    });
  }

  async submitPairwise(actorId: string, runId: string, caseId: string, winner: "A" | "B" | "tie", comparisonReason?: string): Promise<EvaluationRunRecord> {
    return this.repository.transaction((state) => {
      requireRole(state, actorId, "evaluator");
      const run = findRun(state, runId);
      if (!run.evaluatorIds.includes(actorId)) throw new Error("Reviewer is not assigned to this run");
      const assignment = run.reviewAssignments.find((item) => item.caseId === caseId && item.evaluatorId === actorId);
      if (!assignment) throw new Error("Pairwise assignment not found");
      const existing = run.rawPairwiseEvaluations.find((item) => item.caseId === caseId && item.evaluatorId === actorId);
      const record: PairwiseEvaluationRecord = {
        id: existing?.id ?? randomUUID(), runId, caseId, evaluatorId: actorId,
        winner, comparisonReason, createdAt: existing?.createdAt ?? new Date().toISOString(),
      };
      run.rawPairwiseEvaluations = run.rawPairwiseEvaluations.filter((item) => item.id !== record.id);
      run.rawPairwiseEvaluations.push(record);
      const reviews = run.rawPairwiseEvaluations.filter((item) => item.caseId === caseId);
      run.pairwiseDecisions = run.pairwiseDecisions.filter((item) => item.caseId !== caseId);
      if (reviews.length === 2) {
        const roles = reviews.map((item) => item.winner === "tie" ? "tie" : run.reviewAssignments.find((map) => map.caseId === caseId && map.evaluatorId === item.evaluatorId)![item.winner === "A" ? "optionA" : "optionB"]);
        run.pairwiseDecisions.push({ caseId, winnerRole: roles[0] === roles[1] ? roles[0] as PairwiseWinner : undefined });
      }
      refreshRun(run);
      audit(state, "pairwise.submitted", actorId, { runId, caseId });
      return structuredClone(run);
    });
  }

  async adjudicate(actorId: string, runId: string, input: Omit<AdjudicationRecord, "id" | "runId" | "adjudicatorId" | "createdAt">): Promise<EvaluationRunRecord> {
    if (!input.reason?.trim()) throw new Error("Adjudication reason is required");
    return this.repository.transaction((state) => {
      requireRole(state, actorId, "adjudicator");
      const run = findRun(state, runId);
      if (run.adjudicatorId !== actorId || run.evaluatorIds.includes(actorId)) throw new Error("Adjudicator is not assigned");
      const record: AdjudicationRecord = { ...input, id: randomUUID(), runId, adjudicatorId: actorId, createdAt: new Date().toISOString() };
      run.adjudications.push(record);
      if (input.formalResultId) {
        const formal = run.formalResults.find((item) => item.id === input.formalResultId);
        if (!formal) throw new Error("Formal result not found");
        if (typeof input.favoriteIntent === "boolean") formal.adjudicatedFavoriteIntent = input.favoriteIntent;
        if (typeof input.adoptionIntent === "boolean") formal.adjudicatedAdoptionIntent = input.adoptionIntent;
      }
      if (input.pairwiseWinner) {
        run.pairwiseDecisions = run.pairwiseDecisions.filter((item) => item.caseId !== input.caseId);
        run.pairwiseDecisions.push({ caseId: input.caseId, winnerRole: input.pairwiseWinner });
      }
      refreshRun(run);
      audit(state, "adjudication.submitted", actorId, { runId, caseId: input.caseId });
      return structuredClone(run);
    });
  }

  async reviewBadCase(actorId: string, runId: string, badCaseId: string, input: { rootCause: string; improvementAction: string }): Promise<EvaluationRunRecord> {
    return this.repository.transaction((state) => {
      requireRole(state, actorId, "admin");
      const run = findRun(state, runId);
      const badCase = run.badCases.find((item) => item.id === badCaseId);
      if (!badCase) throw new Error("Bad case not found");
      badCase.rootCause = input.rootCause.trim();
      badCase.improvementAction = input.improvementAction.trim();
      badCase.updatedAt = new Date().toISOString();
      audit(state, "bad_case.reviewed", actorId, { runId, badCaseId });
      return structuredClone(run);
    });
  }

  async report(actorId: string, runId: string): Promise<EvaluationReport> {
    const state = await this.getState();
    const actor = state.users.find((item) => item.id === actorId && item.status === "active");
    if (!actor) throw new Error("Unauthorized");
    const run = findRun(state, runId);
    if (actor.role === "evaluator" && !run.evaluatorIds.includes(actor.id)) throw new Error("Unauthorized");
    if (actor.role !== "admin" && run.status !== "completed") throw new Error("Report is only available to reviewers after the run is completed");
    return buildEvaluationReport(run);
  }
}

async function addUser(state: EvaluationState, input: { username: string; displayName: string; password: string; role: UserRole }): Promise<EvaluationUser> {
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error("用户名只能包含字母、数字、点、下划线或连字符");
  if (state.users.some((item) => item.username === username)) throw new Error("Username already exists");
  if (!(["admin", "evaluator", "adjudicator"] as const).includes(input.role)) throw new Error("Unsupported user role");
  const digest = await hashPassword(input.password);
  const now = new Date().toISOString();
  const user: EvaluationUser = {
    id: randomUUID(), username, displayName: input.displayName.trim() || username,
    passwordHash: digest.hash, passwordSalt: digest.salt, role: input.role,
    status: "active", failedLoginCount: 0, createdAt: now, updatedAt: now,
  };
  state.users.push(user);
  return structuredClone(user);
}

function requireRole(state: EvaluationState, userId: string, role: UserRole): EvaluationUser {
  const user = state.users.find((item) => item.id === userId && item.status === "active");
  if (!user || user.role !== role) throw new Error(`${role} role required`);
  return user;
}

function findRun(state: EvaluationState, runId: string): EvaluationRunRecord {
  const run = state.runs.find((item) => item.id === runId);
  if (!run) throw new Error("Evaluation run not found");
  return run;
}

function audit(state: EvaluationState, action: string, actorId?: string, payload?: Record<string, unknown>) {
  state.auditLog.push({ id: randomUUID(), action, actorId, payload, createdAt: new Date().toISOString() });
}

function validateHooks(hooks: GeneratedEvaluationHook[]) {
  if (!Array.isArray(hooks) || hooks.length !== 3) throw new Error("Format error: response must contain exactly 3 hooks");
  hooks.forEach((hook, index) => {
    if (!hook.content?.trim() || !hook.styleTag?.trim() || !hook.recommendReason?.trim()) throw new Error(`Format error: hook ${index + 1} fields are incomplete`);
  });
}

function candidateRecord(run: EvaluationRunRecord, evaluationCase: EvaluationCase, taskId: string, promptRole: PromptRole, hook: GeneratedEvaluationHook, index: number): EvaluationCandidate {
  const duplicateRisk = run.candidates.some((item) => item.caseId === evaluationCase.caseId && item.promptRole === promptRole && item.content.trim() === hook.content.trim());
  return {
    id: randomUUID(), generationTaskId: taskId, caseId: evaluationCase.caseId, promptRole,
    candidateIndex: index + 1, content: hook.content.trim(), styleTag: hook.styleTag.trim(),
    recommendReason: hook.recommendReason.trim(), modelScore: hook.modelScore,
    overLength: [...hook.content.trim()].length > evaluationCase.lengthLimit,
    duplicateRisk, selected: false, generationStatus: "success", rawResponse: undefined,
    dataOrigin: "evaluation_set", createdAt: new Date().toISOString(),
  };
}

function validateReview(input: ReviewInput) {
  for (const key of ["usabilityScore", "platformFitScore", "attractivenessScore", "reasonQualityScore"] as const) {
    if (!Number.isInteger(input[key]) || input[key] < 1 || input[key] > 5) throw new Error(`${key} must be an integer from 1 to 5`);
  }
  for (const item of input.badCases) if (!(BAD_CASE_TYPES as readonly string[]).includes(item.type)) throw new Error(`Unsupported bad case type: ${item.type}`);
}

function consolidateBadCases(run: EvaluationRunRecord, formalResultId: string) {
  run.badCases = run.badCases.filter((item) => item.formalResultId !== formalResultId);
  const selected = run.candidates.find((item) => `formal:${item.id}` === formalResultId)!;
  const annotations = run.rawReviews.filter((item) => item.formalResultId === formalResultId).flatMap((item) => item.badCases);
  const severityRank: Record<BadCaseSeverity, number> = { low: 1, medium: 2, high: 3 };
  for (const type of new Set(annotations.map((item) => item.type))) {
    const matching = annotations.filter((item) => item.type === type);
    const strongest = matching.sort((a, b) => severityRank[b.severity] - severityRank[a.severity])[0];
    const now = new Date().toISOString();
    const record: BadCaseRecord = {
      id: randomUUID(), runId: run.id, formalResultId, generationId: selected.id,
      type, severity: strongest.severity, description: strongest.description,
      dataOrigin: "evaluation_set", createdAt: now, updatedAt: now,
    };
    run.badCases.push(record);
  }
  const formal = run.formalResults.find((item) => item.id === formalResultId)!;
  formal.highSeverityBadCaseTypes = run.badCases.filter((item) => item.formalResultId === formalResultId && item.severity === "high").map((item) => item.type);
  formal.badCaseTypes = run.badCases.filter((item) => item.formalResultId === formalResultId).map((item) => item.type);
}

function refreshRun(run: EvaluationRunRecord) {
  const formalComplete = run.formalResults.length === run.caseCount * 2 && run.formalResults.every((item) => item.reviews.length === 2);
  const pairwiseComplete = run.rawPairwiseEvaluations.length === run.caseCount * 2;
  if (!formalComplete || !pairwiseComplete) {
    run.status = "reviewing";
    return;
  }
  const intentConflicts = run.formalResults.some((item) => {
    const [a, b] = item.reviews;
    return (a.favoriteIntent !== b.favoriteIntent && item.adjudicatedFavoriteIntent === undefined)
      || (a.adoptionIntent !== b.adoptionIntent && item.adjudicatedAdoptionIntent === undefined);
  });
  const pairwiseConflicts = run.pairwiseDecisions.some((item) => !item.winnerRole);
  run.status = intentConflicts || pairwiseConflicts ? "adjudicating" : "completed";
  run.updatedAt = new Date().toISOString();
}

const defaultProvider: EvaluationGenerationProvider = {
  async generate(input) {
    if (input.executionMode === "mock") {
      const prefixes = input.promptRole === "baseline"
        ? ["先别急着下结论", "很多人忽略了这一点", "从一个常见问题说起"]
        : ["真正影响结果的不是表面原因", "先避开这个最常见的误区", "用一个具体问题拆开来看"];
      return {
        hooks: prefixes.map((prefix, index) => ({
          content: `${prefix}：${input.evaluationCase.topic}`.slice(0, input.evaluationCase.lengthLimit),
          styleTag: ["问题导向", "避坑提醒", "方法拆解"][index],
          recommendReason: `模拟候选 ${index + 1}，用于验证${input.evaluationCase.platformLabel}评测流程，不代表真实效果。`,
        })),
        rawResponse: { mock: true },
      };
    }
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("Live generation requires DEEPSEEK_API_KEY");
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: input.modelName,
        ...input.modelParameters,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.promptContent },
          { role: "user", content: JSON.stringify({
            caseId: input.evaluationCase.caseId,
            topic: input.evaluationCase.topic,
            platform: input.evaluationCase.platformLabel,
            targetAudience: input.evaluationCase.targetAudience,
            emotionStyle: input.evaluationCase.emotionStyle,
            lengthLimit: input.evaluationCase.lengthLimit,
            output: { hooks: [{ content: "", styleTag: "", recommendReason: "", modelScore: 0 }] },
            requirement: "hooks 必须恰好 3 条，只返回 JSON",
          }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Generation error: HTTP ${response.status}`);
    const raw = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = raw.choices?.[0]?.message?.content;
    if (!content) throw new Error("Format error: empty model response");
    let parsed: { hooks?: GeneratedEvaluationHook[] };
    try { parsed = JSON.parse(content); } catch { throw new Error("Format error: invalid JSON response"); }
    return { hooks: parsed.hooks ?? [], rawResponse: raw };
  },
};
