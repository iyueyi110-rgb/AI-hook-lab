import type { GenerateResponse } from "./types.ts";
import type { AgentCommand, AgentRun, Candidate, MemoryKey, Message } from "./agent/types.ts";

export const COACH_RUN_STORAGE_KEY = "ai-hook-lab-coach-run-id";

export type CoachEndpoint = "runs" | "run" | "turn" | "image" | "memory" | "memoryEntry";

export interface CoachClientRun extends AgentRun {
  createdAt?: string;
  updatedAt?: string;
  summary?: {
    messageCount: number;
    latestMessageAt?: string;
    candidateCount: number;
    status: AgentRun["status"];
  };
}

export interface CoachClientResponse {
  run: CoachClientRun;
  messages: Message[];
  candidates: Candidate[];
  topCandidates: Candidate[];
  comparisonExplanations: string[];
  pendingConfirmation: "brief" | "final" | null;
  allowedCommands: AgentCommand["type"][];
  needsInput: boolean;
  finalizedResponse?: GenerateResponse;
}

export interface CoachMemoryEntry {
  id: string;
  key: MemoryKey;
  value: string;
  confidence: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class CoachClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly response?: CoachClientResponse;

  constructor(status: number, code: string, message: string, response?: CoachClientResponse) {
    super(message);
    this.name = "CoachClientError";
    this.status = status;
    this.code = code;
    this.response = response;
  }
}

export function isCreativeCoachEnabled(value: string | undefined): boolean {
  return value === "true";
}

function validPointer(value: string): boolean {
  return value.length > 0 && value.length <= 200 && /^[A-Za-z0-9._:-]+$/.test(value);
}

export function loadCoachRunId(storage: StorageLike): string | null {
  try {
    const value = storage.getItem(COACH_RUN_STORAGE_KEY);
    if (value && validPointer(value)) return value;
    if (value !== null) storage.removeItem(COACH_RUN_STORAGE_KEY);
  } catch {
    // Storage can be blocked by browser privacy settings.
  }
  return null;
}

export function saveCoachRunId(storage: StorageLike, runId: string | null): void {
  try {
    if (!runId) storage.removeItem(COACH_RUN_STORAGE_KEY);
    else if (validPointer(runId)) storage.setItem(COACH_RUN_STORAGE_KEY, runId);
  } catch {
    // The server-side cookie remains the source of ownership truth.
  }
}

export function canSubmitCoachCommand(
  response: CoachClientResponse | null,
  command: AgentCommand["type"],
): boolean {
  return Boolean(response?.needsInput && response.allowedCommands.includes(command));
}

export function buildCoachEndpoint(kind: CoachEndpoint, id?: string): string {
  if (kind === "runs") return "/api/agent/runs";
  if (kind === "memory") return "/api/agent/memory";
  if (kind === "memoryEntry") return `/api/agent/memory/${encodeURIComponent(id ?? "")}`;
  const run = encodeURIComponent(id ?? "");
  if (kind === "turn") return `/api/agent/runs/${run}/turns`;
  if (kind === "image") return `/api/agent/runs/${run}/image`;
  return `/api/agent/runs/${run}`;
}

export async function readCoachResponse(response: Response): Promise<CoachClientResponse> {
  const payload = (await response.json().catch(() => null)) as
    | CoachClientResponse
    | { error?: string; message?: string; run?: CoachClientResponse["run"] }
    | null;
  if (response.ok && payload && "run" in payload && "allowedCommands" in payload) {
    return payload as CoachClientResponse;
  }
  const structured = payload as ({ error?: string; message?: string } & Partial<CoachClientResponse>) | null;
  const embedded = structured?.run && structured.allowedCommands
    ? structured as CoachClientResponse
    : undefined;
  throw new CoachClientError(
    response.status,
    structured?.error ?? "request_failed",
    structured?.message ?? "创作教练暂时无法处理这个操作。",
    embedded,
  );
}

export async function performCoachWrite(
  request: () => Promise<Response>,
  refreshAfterConflict: () => Promise<unknown>,
): Promise<CoachClientResponse> {
  const response = await request();
  try {
    return await readCoachResponse(response);
  } catch (error) {
    if (error instanceof CoachClientError && error.status === 409) {
      await refreshAfterConflict();
    }
    throw error;
  }
}
