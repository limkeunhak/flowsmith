/**
 * 실행 상태 한 곳 — 캔버스(상태 색) · 아래 로그 패널 · 노드 서랍(입력 · 출력)이 같이 본다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { explainProblems, problemLine, type Flow } from "@flowsmith/core";
import { api, ApiError, type NodeRun, type NodeStatus, type RunRow, type Watch } from "../../api.ts";

export interface RunView {
  runId: string;
  status: "running" | "success" | "failure" | "cancelled" | "blocked";
  message: string;
  /** 도는 순서대로 */
  nodes: NodeRun[];
  output: Record<string, unknown> | null;
  /** 초안 · v3 … */
  label: string;
  startedAt: string;
  ms: number | null;
  /** 사람 기다리기 중이면 — 무엇을 · 어느 노드 · 언제까지 */
  human?: { nodeId: string; prompt: string; deadline: string } | null;
  /** 승인을 기다리는 중이면 — 무엇을 · 누가(역할) · 언제까지 */
  approval?: { nodeId: string; message: string; minRole: "runner" | "editor" | "admin"; deadline: string } | null;
}

export type RunTarget = "draft" | "active" | number;

const blank = (id: string, name: string): NodeRun => ({ id, name, type: "", status: "running", input: null, output: null, branch: null, steps: [], logs: [], failure: null, ms: 0 });

/**
 * 캔버스의 노드 상태 — 고르면 안 되는 행에 걸려 멈춘 노드(막힘 갈래를 잇지 않음)도 «막힘»으로 보인다
 * (사이트가 고장 난 실패와 섞이지 않게 — 실행은 실패로 남는다)
 */
export function statusesOf(view: RunView | null): Record<string, NodeStatus> {
  return Object.fromEntries((view?.nodes ?? []).map((n) => [n.id, n.status === "failed" && n.failure?.problem === "refused" ? "blocked" : n.status]));
}

export function viewOf(r: RunRow): RunView {
  return {
    runId: r.id, status: r.status, message: r.message, label: (r.version === null ? "초안" : `v${r.version}`) + (r.ranOn ? ` · ${r.ranOn}` : ""),
    nodes: r.result?.nodes ?? [], output: r.result?.output ?? null, startedAt: r.startedAt, ms: r.ms,
  };
}

/**
 * 진행 하나를 실행 모양에 더한다 — 편집기(방금 누른 실행)와 실행 기록(알림 링크로 연, 아직 도는 실행)이 같이 쓴다.
 * 끝(run:end)은 여기서 다루지 않는다 — 부르는 쪽이 저장된 결과를 다시 받는다.
 */
export function applyWatch(v: RunView, e: Watch, nameOf: (id: string) => string): RunView {
  switch (e.kind) {
    case "node:start": return { ...v, message: v.message.startsWith("차례를") || v.message.startsWith("자원") ? "" : v.message, nodes: [...v.nodes, { ...blank(e.nodeId, nameOf(e.nodeId)), input: e.input }] };
    case "step": return { ...v, nodes: v.nodes.map((n) => (n.id === e.nodeId ? { ...n, steps: [...n.steps, e.step] } : n)) };
    case "log": return { ...v, nodes: v.nodes.map((n) => (n.id === e.nodeId ? { ...n, logs: [...n.logs, e.text] } : n)) };
    case "node:end": return { ...v, nodes: v.nodes.map((n) => (n.id === e.node.id ? e.node : n)) };
    // 동시 실행 한도 — 차례를 기다린다
    case "run:queued": return { ...v, message: e.ahead > 0 ? `차례를 기다리는 중 — 앞에 ${e.ahead}개` : "차례를 기다리는 중" };
    // 워커(사람 PC)에 갔다 — 차례 기다림은 끝났다
    case "run:placed": return { ...v, label: `${v.label} · ${e.worker}`, message: v.message.startsWith("차례를") ? "" : v.message };
    // 자원 잠금 — 같은 자원(계정 등)을 다른 실행이 쓰고 있다
    case "run:locked": return { ...v, message: `자원 «${e.lock}»을(를) 기다리는 중 — «${e.holder}»이(가) 쓰고 있습니다` };
    case "human": return { ...v, human: e.state === "waiting" ? { nodeId: e.nodeId, prompt: e.prompt, deadline: e.deadline ?? new Date().toISOString() } : null };
    case "approval": return { ...v, approval: e.state === "waiting" ? { nodeId: e.nodeId, message: e.message, minRole: e.minRole, deadline: e.deadline ?? new Date().toISOString() } : null };
    case "run:end": return v;
  }
}

export function useRun(flow: Flow | null, activeVersion: number | null) {
  const [view, setView] = useState<RunView | null>(null);
  const [history, setHistory] = useState<RunRow[]>([]);
  const [error, setError] = useState<string[] | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const flowId = flow?.id ?? null;
  const flowRef = useRef(flow);
  flowRef.current = flow;

  const reloadHistory = useCallback(() => {
    if (flowId) void api.listRuns(flowId).then(setHistory, () => undefined);
  }, [flowId]);
  useEffect(() => { reloadHistory(); return () => stop.current?.(); }, [reloadHistory]);

  /** part — 일부만 · on — 이번만 어디서(워커) */
  const start = useCallback(async (target: RunTarget, params: Record<string, string>, part?: { stopBefore?: string; stopAfter?: string; on?: string }): Promise<boolean> => {
    if (!flowId) return false;
    setError(null);
    const version = target === "draft" ? "draft" as const : target === "active" ? undefined : target;
    let runId: string;
    try {
      runId = (await api.startRun(flowId, version, params, part)).runId;
    } catch (e) {
      setError(e instanceof ApiError ? [e.message, ...explainProblems(e.problems, flowRef.current).map(problemLine)] : [String(e)]);
      return false;
    }
    const label = (target === "draft" ? "초안" : target === "active" ? `v${activeVersion}` : `v${target}`) + (part?.stopBefore || part?.stopAfter ? " · 일부" : "");
    const startedAt = new Date().toISOString();
    const nameOf = (id: string) => flowRef.current?.nodes.find((n) => n.id === id)?.name ?? id;
    setView({ runId, status: "running", message: "", nodes: [], output: null, label, startedAt, ms: null, human: null, approval: null });
    stop.current?.();
    stop.current = api.watchRun(runId, (e) => {
      // 끝 — 건너뛴 · 안 돈 노드까지 담긴 결과를 받아 온다
      if (e.kind === "run:end") { void api.getRun(runId).then((r) => { setView(viewOf(r)); reloadHistory(); }); return; }
      setView((v) => (v && v.runId === runId ? applyWatch(v, e, nameOf) : v));
    });
    return true;
  }, [flowId, activeVersion, reloadHistory]);

  const open = useCallback(async (runId: string) => {
    setView(viewOf(await api.getRun(runId)));
  }, []);

  const clear = useCallback(() => { setView(null); setError(null); }, []);

  const statuses = statusesOf(view);
  return { view, history, error, statuses, start, open, clear, reloadHistory };
}
