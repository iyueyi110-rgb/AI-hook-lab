import { randomUUID } from "node:crypto";

import { activationReadiness } from "./evidence.ts";
import type {
  StrategyEvidence,
  StrategyReview,
  StrategyReviewAction,
  StrategyVersion,
} from "./types.ts";
import { computeStrategyContentHash, strategyContentFromStored } from "./validation.ts";

export class StrategyTransitionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "StrategyTransitionError";
    this.code = code;
  }
}

export type StrategyAction =
  | { action: "submit_review"; expectedRevision: number; actorId: string; reason?: string }
  | { action: "approve_experiment"; expectedRevision: number; actorId: string; reason?: string }
  | { action: "reject"; expectedRevision: number; actorId: string; reason: string }
  | { action: "activate"; expectedRevision: number; actorId: string; expiresInDays: number; reason?: string }
  | { action: "archive"; expectedRevision: number; actorId: string; reason?: string };

export type StrategyActionInput = StrategyAction extends infer Action
  ? Action extends StrategyAction
    ? Omit<Action, "actorId">
    : never
  : never;

const TRANSITIONS: Record<StrategyAction["action"], StrategyVersion["status"][]> = {
  submit_review: ["draft"],
  approve_experiment: ["pending_review"],
  reject: ["pending_review"],
  activate: ["approved_experiment"],
  archive: ["approved_experiment", "active"],
};

function nextStatus(action: StrategyAction["action"]): StrategyVersion["status"] {
  return action === "submit_review"
    ? "pending_review"
    : action === "approve_experiment"
      ? "approved_experiment"
      : action === "reject"
        ? "rejected"
        : action === "activate"
          ? "active"
          : "archived";
}

export function applyStrategyAction(
  current: StrategyVersion,
  action: StrategyAction,
  evidence: StrategyEvidence[],
  now = new Date(),
): { version: StrategyVersion; review: StrategyReview } {
  if (current.revision !== action.expectedRevision) throw new StrategyTransitionError("revision_conflict");
  if (!TRANSITIONS[action.action].includes(current.status)) throw new StrategyTransitionError("invalid_transition");
  const content = strategyContentFromStored(current);
  if (computeStrategyContentHash(content) !== current.contentHash) throw new StrategyTransitionError("content_hash_mismatch");
  if (action.action === "activate") {
    if (!Number.isInteger(action.expiresInDays) || action.expiresInDays < 7 || action.expiresInDays > 90) {
      throw new StrategyTransitionError("invalid_expiry");
    }
    if (!activationReadiness(current, evidence, now).ready) throw new StrategyTransitionError("activation_evidence_missing");
  }
  const timestamp = now.toISOString();
  const status = nextStatus(action.action);
  const version: StrategyVersion = {
    ...current,
    status,
    revision: current.revision + 1,
    updatedAt: timestamp,
    ...(action.action === "activate"
      ? {
          activatedAt: timestamp,
          expiresAt: new Date(now.getTime() + action.expiresInDays * 24 * 60 * 60 * 1_000).toISOString(),
        }
      : {}),
    ...(action.action === "archive" ? { archivedAt: timestamp } : {}),
  };
  const review: StrategyReview = {
    id: randomUUID(),
    cardId: current.cardId,
    strategyVersion: current.version,
    action: action.action as StrategyReviewAction,
    actorId: action.actorId,
    ...(action.reason?.trim() ? { reason: action.reason.trim().slice(0, 500) } : {}),
    contentHash: current.contentHash,
    createdAt: timestamp,
  };
  return { version, review };
}
