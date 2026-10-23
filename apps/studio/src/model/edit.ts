/**
 * 초안 고치기 — 녹화를 넣고 · 다시 지정한 위치를 넣고 · 없어진 포트의 선을 치운다. 순수하다(새 객체를 돌려준다).
 */
import type { Flow, Target, WebAction } from "@flowsmith/core";
import { nextId } from "./nodes.ts";
import { portsOf } from "./graph.ts";
import { withTarget } from "./fix.ts";

/** 노드를 고친 뒤 — 없어진 포트(지운 갈래)에서 나가던 선을 치운다 */
export function pruneEdges(f: Flow): Flow {
  const ports = new Map(f.nodes.map((n) => [n.id, new Set(portsOf(n).map((p) => p.id))]));
  const edges = f.edges.filter((e) => ports.get(e.from.node)?.has(e.from.port) ?? false);
  return edges.length === f.edges.length ? f : { ...f, edges };
}

/** 녹화한 동작을 웹페이지 노드 끝에 붙인다 — id는 그 노드 안에서 겹치지 않게 다시 짓는다 */
export function addRecorded(f: Flow, nodeId: string, actions: readonly WebAction[]): Flow {
  return {
    ...f,
    nodes: f.nodes.map((n) => {
      if (n.id !== nodeId || n.type !== "web") return n;
      const ids = n.config.actions.map((a) => a.id);
      const added = actions.map((a) => { const id = nextId("a", ids); ids.push(id); return { ...a, id }; });
      return { ...n, config: { ...n.config, actions: [...n.config.actions, ...added] } };
    }),
  };
}

/** 다시 지정한 위치를 그 동작에 — 나머지(값 · 출력 이름 · 되돌릴 수 없음)는 그대로 */
export function applyTarget(f: Flow, nodeId: string, actionId: string, target: Target): Flow {
  return {
    ...f,
    nodes: f.nodes.map((n) => (n.id !== nodeId || n.type !== "web" ? n
      : { ...n, config: { ...n.config, actions: n.config.actions.map((a): WebAction => (a.id !== actionId ? a : withTarget(a, target))) } })),
  };
}

/** 다시 지정할 때 사람이 부르는 그 요소의 이름 */
export function targetLabel(a: WebAction): string {
  return "target" in a && a.target ? a.target.label
    : a.kind === "readTable" ? a.table.label
    : a.kind === "pickRow" ? a.pick.label
    : a.kind === "wait" && "target" in a.wait ? a.wait.target.label
    : "";
}
