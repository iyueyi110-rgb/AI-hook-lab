"use client";

import * as React from "react";
import type { AgentCommand, CreativeBrief } from "@/lib/agent/types";
import type { GenerateResponse } from "@/lib/types";
import {
  CoachClientError,
  CoachWriteInFlightError,
  buildCoachEndpoint,
  canSubmitCoachCommand,
  collectCoachToolEvents,
  createCoachWriteGate,
  loadCoachRunId,
  performCoachWrite,
  readCoachResponse,
  saveCoachRunId,
  type CoachClientResponse,
  type CoachMemoryEntry,
} from "@/lib/creativeCoachClient";

export interface CreativeCoachError {
  title: string;
  message: string;
  status?: number;
  code?: string;
  revisionConflict?: boolean;
}

type CoachEventType =
  | "agent_run_start"
  | "agent_clarification"
  | "agent_brief_confirmed"
  | "agent_tool_call"
  | "agent_revision"
  | "agent_final_confirmed"
  | "agent_memory_applied"
  | "agent_memory_deleted";

interface UseCreativeCoachOptions {
  onFinalized?: (response: GenerateResponse) => void;
  track?: (type: CoachEventType, payload: Record<string, unknown>) => void;
}

interface CreateCoachRunInput {
  brief: Partial<CreativeBrief>;
  hasImage?: boolean;
  ignoreMemory?: boolean;
}

function errorView(error: unknown): CreativeCoachError {
  if (error instanceof CoachClientError) {
    return {
      title: error.status === 409 ? "状态已更新" : "教练操作未完成",
      message: error.status === 409
        ? "检测到另一项操作或旧页面提交，已刷新到最新状态。请确认后再继续。"
        : error.message,
      status: error.status,
      code: error.code,
      revisionConflict: error.status === 409,
    };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { title: "请求已取消", message: "上一项操作已被新的操作替代。" };
  }
  if (error instanceof CoachWriteInFlightError) {
    return { title: "已有操作正在进行", message: "请等待当前操作完成后再继续。" };
  }
  return {
    title: "网络连接失败",
    message: error instanceof Error ? error.message : "请检查网络后重试。",
  };
}

function clarificationField(response: CoachClientResponse): "topic" | "platform" | "contentType" {
  if (!response.run.briefDraft?.topic) return "topic";
  if (!response.run.briefDraft?.platform) return "platform";
  return "contentType";
}

export function useCreativeCoach(options: UseCreativeCoachOptions = {}) {
  const { onFinalized, track } = options;
  const [response, setResponse] = React.useState<CoachClientResponse | null>(null);
  const [memory, setMemory] = React.useState<CoachMemoryEntry[]>([]);
  const [loadingAction, setLoadingAction] = React.useState<string | null>(null);
  const [runRestoring, setRunRestoring] = React.useState(true);
  const [memoryRestoring, setMemoryRestoring] = React.useState(true);
  const [error, setError] = React.useState<CreativeCoachError | null>(null);
  const readRequestRef = React.useRef<AbortController | null>(null);
  const writeRequestRef = React.useRef<AbortController | null>(null);
  const writeGateRef = React.useRef(createCoachWriteGate());
  const memoryRequestRef = React.useRef<AbortController | null>(null);
  const mountedRef = React.useRef(true);
  const seenToolCalls = React.useRef(new Set<string>());
  const rememberToolCalls = React.useCallback((next: CoachClientResponse) => {
    for (const call of next.run.toolCalls) seenToolCalls.current.add(call.id);
  }, []);
  const recordToolEvents = React.useCallback((next: CoachClientResponse) => {
    for (const event of collectCoachToolEvents(next, seenToolCalls.current)) {
      track?.("agent_tool_call", {
        status: event.status,
        tool: event.tool,
        candidateCount: next.candidates.length,
      });
    }
  }, [track]);

  const acceptResponse = React.useCallback((next: CoachClientResponse) => {
    if (!mountedRef.current) return;
    setResponse(next);
    setError(null);
    saveCoachRunId(window.localStorage, next.run.id);
    recordToolEvents(next);
    if (next.finalizedResponse) {
      onFinalized?.(next.finalizedResponse);
    }
  }, [onFinalized, recordToolEvents]);

  const fetchRun = React.useCallback(async (runId: string, signal: AbortSignal) => {
    const response = await fetch(buildCoachEndpoint("run", runId), {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
    return readCoachResponse(response);
  }, []);

  const refreshRun = React.useCallback(async (runId?: string, preserveError = false) => {
    const selected = runId ?? (typeof window === "undefined" ? null : loadCoachRunId(window.localStorage));
    if (!selected) {
      setRunRestoring(false);
      return null;
    }
    readRequestRef.current?.abort();
    const controller = new AbortController();
    readRequestRef.current = controller;
    if (!preserveError) setError(null);
    try {
      const next = await fetchRun(selected, controller.signal);
      if (!controller.signal.aborted && mountedRef.current) {
        setResponse(next);
        saveCoachRunId(window.localStorage, next.run.id);
        rememberToolCalls(next);
        if (next.finalizedResponse) {
          onFinalized?.(next.finalizedResponse);
        }
      }
      return next;
    } catch (caught) {
      if (controller.signal.aborted) return null;
      if (caught instanceof CoachClientError && caught.status === 404) {
        saveCoachRunId(window.localStorage, null);
        setResponse(null);
      } else if (!preserveError) {
        setError(errorView(caught));
      }
      return null;
    } finally {
      if (readRequestRef.current === controller) readRequestRef.current = null;
      if (mountedRef.current) setRunRestoring(false);
    }
  }, [fetchRun, onFinalized, rememberToolCalls]);

  const executeWrite = React.useCallback((
    action: string,
    runId: string | undefined,
    requestFactory: (signal: AbortSignal) => Promise<Response>,
  ) => writeGateRef.current.run(`${runId ?? "new"}:${action}`, async () => {
      const controller = new AbortController();
      writeRequestRef.current = controller;
      setLoadingAction(action);
      setError(null);
      try {
        const next = await performCoachWrite(
          () => requestFactory(controller.signal),
          async () => {
            if (!runId) return;
            const latest = await fetchRun(runId, controller.signal);
            acceptResponse(latest);
          },
        );
        acceptResponse(next);
        return next;
      } catch (caught) {
        if (controller.signal.aborted) return null;
        const view = errorView(caught);
        if (caught instanceof CoachClientError && caught.response) acceptResponse(caught.response);
        if (mountedRef.current) setError(view);
        return null;
      } finally {
        if (writeRequestRef.current === controller) writeRequestRef.current = null;
        if (mountedRef.current) setLoadingAction(null);
      }
    }).catch((caught) => {
      if (mountedRef.current) setError(errorView(caught));
      return null;
    }), [acceptResponse, fetchRun]);

  const refreshMemory = React.useCallback(async () => {
    if (mountedRef.current) setMemoryRestoring(true);
    memoryRequestRef.current?.abort();
    const controller = new AbortController();
    memoryRequestRef.current = controller;
    try {
      const raw = await fetch(buildCoachEndpoint("memory"), {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      const body = await raw.json().catch(() => null) as { entries?: CoachMemoryEntry[]; message?: string } | null;
      if (!raw.ok) throw new CoachClientError(raw.status, "memory_failed", body?.message ?? "无法读取偏好");
      if (!controller.signal.aborted && mountedRef.current) setMemory(Array.isArray(body?.entries) ? body.entries : []);
    } catch (caught) {
      if (!controller.signal.aborted && !(caught instanceof CoachClientError && caught.status === 404)) {
        setError(errorView(caught));
      }
    } finally {
      if (memoryRequestRef.current === controller) memoryRequestRef.current = null;
      if (mountedRef.current) setMemoryRestoring(false);
    }
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    const restore = async () => {
      await Promise.all([refreshRun(), refreshMemory()]);
    };
    void restore();
    return () => {
      mountedRef.current = false;
      readRequestRef.current?.abort();
      writeRequestRef.current?.abort();
      memoryRequestRef.current?.abort();
    };
  }, [refreshMemory, refreshRun]);

  const createRun = React.useCallback(async (input: CreateCoachRunInput) => {
    const next = await executeWrite("create", undefined, (signal) => fetch(buildCoachEndpoint("runs"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
    }));
    if (next) {
      track?.("agent_run_start", {
        status: next.run.status,
        ...(next.run.briefDraft?.platform ? { platform: next.run.briefDraft.platform } : {}),
        ...(next.run.briefDraft?.contentType ? { contentType: next.run.briefDraft.contentType } : {}),
        memoryCount: next.run.memory.entries.length,
      });
      if ((next.run.appliedMemoryKeys?.length ?? 0) > 0) {
        track?.("agent_memory_applied", {
          status: next.run.status,
          memoryCount: next.run.appliedMemoryKeys!.length,
        });
      }
      if (next.run.status === "understanding") {
        track?.("agent_clarification", {
          status: next.run.status,
          field: clarificationField(next),
          attempt: next.run.clarificationAttempts ?? 1,
        });
      }
    }
    return next;
  }, [executeWrite, track]);

  const submitCommand = React.useCallback(async (command: AgentCommand) => {
    if (!response || !canSubmitCoachCommand(response, command.type)) return null;
    const expectedRevision = response.run.revision;
    const startedAt = Date.now();
    const next = await executeWrite(command.type, response.run.id, (signal) => fetch(buildCoachEndpoint("turn", response.run.id), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision, command }),
      signal,
    }));
    if (!next) return null;
    if (command.type === "confirm_brief") {
      track?.("agent_brief_confirmed", {
        status: next.run.status,
        ...(next.run.brief?.platform ? { platform: next.run.brief.platform } : {}),
        ...(next.run.brief?.contentType ? { contentType: next.run.brief.contentType } : {}),
        memoryCount: next.run.memory.entries.length,
      });
    } else if (command.type === "rewrite_candidate" || command.type === "reject_batch") {
      track?.("agent_revision", {
        status: next.run.status,
        command: command.type,
        round: next.run.revisionRounds,
        candidateCount: next.candidates.length,
      });
    } else if (command.type === "confirm_final") {
      track?.("agent_final_confirmed", {
        status: next.run.status,
        candidateCount: next.finalizedResponse?.hooks.length ?? 1,
        durationMs: Math.max(0, Date.now() - startedAt),
      });
    } else if (next.run.status === "understanding" && command.type === "message") {
      track?.("agent_clarification", {
        status: next.run.status,
        field: clarificationField(next),
        attempt: next.run.clarificationAttempts ?? 1,
      });
    }
    return next;
  }, [executeWrite, response, track]);

  const uploadImage = React.useCallback(async (file: File, target = response) => {
    if (!target || target.run.status !== "analyzing_image") return null;
    const expectedRevision = target.run.revision;
    const form = new FormData();
    form.append("image", file);
    form.append("expectedRevision", String(expectedRevision));
    return executeWrite("image", target.run.id, (signal) => fetch(buildCoachEndpoint("image", target.run.id), {
      method: "POST",
      credentials: "same-origin",
      body: form,
      signal,
    }));
  }, [executeWrite, response]);

  const cancelRun = React.useCallback(async () => {
    if (!response) return;
    const next = await executeWrite("cancel", response.run.id, (signal) => fetch(
      `${buildCoachEndpoint("run", response.run.id)}?expectedRevision=${response.run.revision}`,
      { method: "DELETE", credentials: "same-origin", signal },
    ));
    if (next) saveCoachRunId(window.localStorage, null);
  }, [executeWrite, response]);

  const deleteMemory = React.useCallback(async (memoryId: string) => {
    try {
      const raw = await fetch(buildCoachEndpoint("memoryEntry", memoryId), {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
      if (!raw.ok) throw new CoachClientError(raw.status, "memory_delete_failed", "无法删除这项偏好");
      const next = memory.filter((entry) => entry.id !== memoryId);
      setMemory(next);
      track?.("agent_memory_deleted", { scope: "single", memoryCount: next.length });
    } catch (caught) {
      setError(errorView(caught));
    }
  }, [memory, track]);

  const clearMemory = React.useCallback(async () => {
    try {
      const raw = await fetch(buildCoachEndpoint("memory"), {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
      if (!raw.ok) throw new CoachClientError(raw.status, "memory_clear_failed", "无法清空偏好");
      setMemory([]);
      track?.("agent_memory_deleted", { scope: "all", memoryCount: 0 });
    } catch (caught) {
      setError(errorView(caught));
    }
  }, [track]);

  return {
    response,
    memory,
    error,
    loadingAction,
    loading: Boolean(loadingAction),
    restoring: runRestoring || memoryRestoring,
    createRun,
    refreshRun,
    submitCommand,
    uploadImage,
    cancelRun,
    refreshMemory,
    deleteMemory,
    clearMemory,
    clearError: () => setError(null),
    reset: () => {
      readRequestRef.current?.abort();
      writeRequestRef.current?.abort();
      saveCoachRunId(window.localStorage, null);
      setResponse(null);
      setError(null);
    },
  };
}
