/**
 * **다른 플로우 실행 노드** — 행마다(또는 한 번) 다른 플로우를 돌린다.
 *
 * ★엣지로는 객체 하나만 간다(결정 5) — 행마다 웹 작업을 하려면 한 건짜리 플로우를 만들고 이 노드가 행마다 부른다.
 *  행마다 실행 기록이 따로 남는다(어느 행이 왜 실패했는지 보인다).
 * ★엔진은 다른 플로우를 모른다 — 부르는 일은 실행기에 준 `callFlow`가 한다(서버가 매니페스트 · 시크릿 · 기록을 맡는다).
 */
import { evaluate, type FlowCallNode, type Output, type Scope } from "@flowsmith/core";
import { RunStopped } from "../errors.ts";

export interface CallFlowRequest {
  flowId: string;
  version: "active" | "draft";
  params: Record<string, string>;
  /** 몇 번째 행인가(0부터) — 한 번만 돌면 0 */
  index: number;
}

export interface CallFlowResult {
  /** 실행 기록 id — 시작조차 못 했으면 null */
  runId: string | null;
  status: "success" | "failure";
  message: string;
  output: Record<string, unknown>;
}

export type CallFlow = (req: CallFlowRequest) => Promise<CallFlowResult>;

export class FlowCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowCallError";
  }
}

const asParam = (v: unknown): string =>
  v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);

export async function runFlowCallNode(node: FlowCallNode, scope: Scope, callFlow: CallFlow | undefined, log: (text: string) => void, signal?: AbortSignal): Promise<Output> {
  const c = node.config;
  if (!callFlow) throw new FlowCallError("다른 워크플로우를 부를 수 없습니다 — 서버에서 돌리세요");
  const noSecrets: Scope = { ...scope, secrets: {} };

  // 행들 — 비어 있으면 한 번
  let items: unknown[] = [undefined];
  if (c.items !== "") {
    const v = evaluate(c.items, noSecrets).value;
    if (v === undefined || v === null) throw new FlowCallError(`행들이 없습니다 — ${c.items}`);
    items = Array.isArray(v) ? v : [v];
  }
  if (items.length === 0) {
    log("행이 없어 부르지 않았습니다");
    return { results: [], succeeded: 0, failed: 0 };
  }

  const results: (CallFlowResult & { index: number })[] = [];
  let stopped = false;
  let next = 0;
  const one = async (index: number): Promise<void> => {
    const item = items[index];
    const params = Object.fromEntries(Object.entries(c.params).map(([k, t]) => [k, asParam(evaluate(t, { ...noSecrets, item }).value)]));
    let r: CallFlowResult;
    try { r = await callFlow({ flowId: c.flowId, version: c.version, params, index }); } catch (e) {
      r = { runId: null, status: "failure", message: e instanceof Error ? e.message : String(e), output: {} };
    }
    results.push({ index, ...r });
    log(`${items.length > 1 ? `${index + 1}/${items.length} ` : ""}${c.flowId} — ${r.status === "success" ? "성공" : `실패: ${r.message}`}${r.runId ? ` (실행 ${r.runId.slice(0, 8)})` : ""}`);
    if (r.status === "failure" && c.onError === "stop") stopped = true;
  };
  // 동시에 concurrency개까지 — 실패로 멈추면 새로 시작하지 않는다(돌고 있는 것은 끝까지)
  const worker = async () => {
    while (!stopped && !signal?.aborted && next < items.length) await one(next++);
  };
  await Promise.all(Array.from({ length: Math.min(c.concurrency, items.length) }, worker));
  // 멈추기 — 돌던 것은 서버가 함께 멈춘다(부른 실행 · parentRunId). 남은 행은 부르지 않는다
  if (signal?.aborted) throw new RunStopped();

  results.sort((a, b) => a.index - b.index);
  const failed = results.filter((r) => r.status === "failure");
  if (stopped) {
    const f = failed[0]!;
    const skipped = items.length - results.length;
    throw new FlowCallError(`${items.length > 1 ? `${f.index + 1}번째 행에서 ` : ""}${c.flowId} 실행이 실패해 멈췄습니다 — ${f.message}${skipped ? ` (남은 ${skipped}개는 부르지 않음)` : ""}`);
  }
  return {
    results: results.map((r) => ({ index: r.index, runId: r.runId, status: r.status, message: r.message, output: r.output })),
    succeeded: results.length - failed.length,
    failed: failed.length,
  };
}
