/**
 * **웹페이지 노드 나누기**(사용자 요청 2026-10-22 «한 노드에 단계가 너무 많다 — 페이지 접속 → 로그인(사람 대기) → 주문 읽기처럼»).
 *   동작 목록을 자른 곳마다 새 웹페이지 노드(«앞 페이지에서 이어서»)를 만들고 차례로 잇는다 — 같은 브라우저 페이지에서 이어 돈다.
 *   ★이어진 웹페이지 노드는 앞 노드가 읽은 값을 함께 넘긴다(core graph.ts · engine run.ts) — 나누기 전과 결과가 같다.
 *   ★원래 id는 **마지막 조각**이 가진다 — 뒤로 나가는 선 · {{ $node.원래id.x }}가 그대로 맞는다. 들어오던 선은 첫 조각으로.
 */
import { BLOCKED_PORT, OUT_PORT, blockRules, type Edge, type Flow, type FlowNode, type WebAction, type WebNode } from "@flowsmith/core";
import { nextId } from "./nodes.ts";

const GAP_X = 240;
export const HUMAN_NODE_NAME = "사람 기다리기";
export const OPEN_NODE_NAME = "페이지 접속";

const isHumanOnly = (actions: readonly WebAction[]): boolean => actions.length > 0 && actions.every((a) => a.kind === "human");

/** 사람 기다리기마다 앞뒤를 자를 곳 — [접속] → [사람 기다리기] → [그 뒤 동작] … */
export function stageCuts(node: WebNode): number[] {
  const as = node.config.actions;
  const cuts = new Set<number>();
  as.forEach((a, i) => {
    if (a.kind !== "human") return;
    // 맨 앞의 사람 기다리기 — 주소로 시작하면 «페이지 접속»을 따로(앞 페이지에서 이어서면 자를 앞이 없다)
    if (i > 0 || node.config.start.kind !== "continue") cuts.add(i);
    if (i + 1 < as.length) cuts.add(i + 1);
  });
  return [...cuts].sort((x, y) => x - y);
}

/** 이 노드를 나눌 수 있나 — 자를 곳이 하나라도 */
export const canSplitStages = (n: FlowNode): n is WebNode => n.type === "web" && stageCuts(n).length > 0;

/**
 * 동작 목록을 cuts(동작 번호 — 그 동작부터 새 노드)에서 자른다. 0은 주소로 시작할 때만(«페이지 접속»만 남는 첫 조각).
 * 돌려주는 ids는 앞에서부터 조각 노드들(마지막이 원래 id).
 */
export function splitWebNode(f: Flow, nodeId: string, cuts: readonly number[]): { flow: Flow; ids: string[] } {
  const node = f.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "web") return { flow: f, ids: [nodeId] };
  const as = node.config.actions;
  const at = [...new Set(cuts)].filter((c) => c < as.length && (c > 0 || (c === 0 && node.config.start.kind !== "continue"))).sort((x, y) => x - y);
  if (at.length === 0) return { flow: f, ids: [nodeId] };

  const bounds = [0, ...at.filter((c) => c > 0), as.length];
  const chunks: WebAction[][] = [];
  if (at[0] === 0) chunks.push([]);   // 페이지 접속만
  for (let i = 0; i + 1 < bounds.length; i++) chunks.push(as.slice(bounds[i], bounds[i + 1]));

  // 이름 — 비면 «페이지 접속» · 사람 기다리기뿐이면 «사람 기다리기» · 그 밖은 원래 이름(여럿이면 번호)
  const plain = chunks.filter((c) => c.length > 0 && !isHumanOnly(c)).length;
  let k = 0;
  const nameOf = (c: WebAction[]): string => {
    if (c.length === 0) return OPEN_NODE_NAME;
    if (isHumanOnly(c)) return HUMAN_NODE_NAME;
    k++;
    return plain > 1 ? `${node.name} (${k})` : node.name;
  };
  const taken = f.nodes.map((n) => n.id);
  const ids = chunks.map((_, i) => {
    if (i === chunks.length - 1) return node.id;
    const id = nextId("web", taken);
    taken.push(id);
    return id;
  });
  const parts: WebNode[] = chunks.map((c, i) => ({
    ...node,
    id: ids[i]!,
    name: nameOf(c),
    position: { x: node.position.x + i * GAP_X, y: node.position.y },
    config: { start: i === 0 ? node.config.start : { kind: "continue" }, actions: c },
  }));

  // 선 — 들어오던 것은 첫 조각으로 · 조각끼리 차례로 · 막힘 갈래는 막을 행을 가진 조각에서
  const blockOwner = parts.find((p) => blockRules(p).length > 0)?.id ?? null;
  const eid = (es: Edge[]) => nextId("e", es.map((e) => e.id));
  let edges: Edge[] = f.edges.flatMap((e): Edge[] => {
    if (e.from.node === node.id && e.from.port === BLOCKED_PORT) return blockOwner ? [{ ...e, from: { node: blockOwner, port: BLOCKED_PORT } }] : [];
    if (e.to.node === node.id) return [{ ...e, to: { node: ids[0]! } }];
    return [e];
  });
  for (let i = 0; i + 1 < ids.length; i++) edges = [...edges, { id: eid(edges), from: { node: ids[i]!, port: OUT_PORT }, to: { node: ids[i + 1]! } }];

  // 뒤쪽 노드는 늘어난 만큼 오른쪽으로 민다 — 겹치지 않게
  const shift = (chunks.length - 1) * GAP_X;
  const behind = new Set<string>();
  const stack = f.edges.filter((e) => e.from.node === node.id).map((e) => e.to.node);
  while (stack.length) {
    const cur = stack.pop()!;
    if (behind.has(cur) || cur === node.id) continue;
    behind.add(cur);
    for (const e of f.edges) if (e.from.node === cur) stack.push(e.to.node);
  }
  const others = f.nodes.filter((n) => n.id !== node.id).map((n) => (behind.has(n.id) ? { ...n, position: { x: n.position.x + shift, y: n.position.y } } : n));
  const at0 = f.nodes.findIndex((n) => n.id === node.id);
  const nodes = [...others.slice(0, at0), ...parts, ...others.slice(at0)];
  return { flow: { ...f, nodes, edges }, ids };
}

/** 사람 기다리기마다 단계로 나눈다 */
export const splitStages = (f: Flow, nodeId: string): { flow: Flow; ids: string[] } => {
  const n = f.nodes.find((x) => x.id === nodeId);
  return n?.type === "web" ? splitWebNode(f, nodeId, stageCuts(n)) : { flow: f, ids: [nodeId] };
};

/** 캔버스 · 노드 창에서 웹페이지 노드의 얼굴 — 사람 기다리기뿐 · 접속만 · 보통 */
export function webFace(n: FlowNode): "human" | "open" | null {
  if (n.type !== "web") return null;
  if (isHumanOnly(n.config.actions)) return "human";
  if (n.config.actions.length === 0 && n.config.start.kind !== "continue") return "open";
  return null;
}
