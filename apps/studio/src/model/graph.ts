/**
 * 그래프 다루기 — 출력 · 입력 이름 · 넣을 수 있는 값 · 포트 · 순환 미리 보기 · 노드 넣고 잇기.
 */
import { APPROVAL_OUTPUTS, CHECK_OUTPUTS, BLOCKED_OUTPUTS, BLOCKED_PORT, blockRules, FILE_READ_OUTPUTS, FLOW_CALL_OUTPUTS, HTTP_OUTPUTS, STORE_OUTPUTS, TRANSFORM_OUTPUTS, ELSE_PORT, OUT_PORT, SECRET_PARTS, type ConditionCase, type Flow, type FlowNode, type Ref, parseTemplate } from "@flowsmith/core";
import { newNode, nextId, type NodeChoice } from "./nodes.ts";

/** 단계 번호(1부터) — 캔버스 위치로 매긴다(왼쪽 → 오른쪽, 같은 열이면 위 → 아래). 공정 카드와 공정 트랙이 같은 번호를 쓴다 */
export function stepNumbers(flow: Flow): Map<string, number> {
  const order = [...flow.nodes].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  return new Map(order.map((n, i) => [n.id, i + 1]));
}

/** 노드가 내놓는 출력 이름들 — 초안이 틀려 있어도 계산되게 너그럽게 */
export function outputsOf(flow: Flow, nodeId: string, seen = new Set<string>()): string[] {
  if (seen.has(nodeId)) return [];
  seen.add(nodeId);
  const n = flow.nodes.find((x) => x.id === nodeId);
  if (!n) return [];
  switch (n.type) {
    // 앞 페이지에서 이어서 — 앞 노드가 넘긴 것도 함께(core graph.ts와 같다)
    case "web": return [...new Set([...(n.config.start.kind === "continue" ? inputsOf(flow, nodeId, seen) : []), ...n.config.actions.flatMap((a) => (a.kind === "read" || a.kind === "readTable") && a.output ? [a.output] : [])])];
    case "custom": return n.config.outputs;
    case "extension": return n.config.outputs;
    case "fileWrite": return [...STORE_OUTPUTS];
    case "fileRead": return [...FILE_READ_OUTPUTS];
    case "flowCall": return [...FLOW_CALL_OUTPUTS];
    case "http": return [...HTTP_OUTPUTS];
    case "transform": return [...TRANSFORM_OUTPUTS];
    case "approval": return [...new Set([...inputsOf(flow, nodeId, seen), ...APPROVAL_OUTPUTS])];
    case "check": return [...new Set([...inputsOf(flow, nodeId, seen), ...CHECK_OUTPUTS])];
    case "condition": return inputsOf(flow, nodeId, seen);
  }
}

export function inputsOf(flow: Flow, nodeId: string, seen = new Set<string>()): string[] {
  const out = new Set<string>();
  for (const e of flow.edges) {
    if (e.to.node !== nodeId) continue;
    // 막힘 갈래 — 그 노드가 받은 값 + 막힌 까닭(그 노드가 읽은 것은 없다)
    if (e.from.port === BLOCKED_PORT) { for (const f of inputsOf(flow, e.from.node, seen)) out.add(f); for (const f of BLOCKED_OUTPUTS) out.add(f); }
    else for (const f of outputsOf(flow, e.from.node, seen)) out.add(f);
  }
  return [...out];
}

/** 앞 노드가 내놓는 이 이름을 실제로 만든 노드 — 조건 노드는 받은 것을 넘기기만 하므로 더 앞으로 간다 */
export function producerOf(flow: Flow, nodeId: string, field: string, seen = new Set<string>()): FlowNode | null {
  if (seen.has(nodeId)) return null;
  seen.add(nodeId);
  for (const e of flow.edges) {
    if (e.to.node !== nodeId) continue;
    const from = flow.nodes.find((n) => n.id === e.from.node);
    if (!from) continue;
    if (from.type === "condition") { const p = producerOf(flow, from.id, field, seen); if (p) return p; continue; }
    if (e.from.port === BLOCKED_PORT) {
      if ((BLOCKED_OUTPUTS as readonly string[]).includes(field)) return from;
      const p = producerOf(flow, from.id, field, seen); if (p) return p; continue;
    }
    if (outputsOf(flow, from.id).includes(field)) return from;
  }
  return null;
}

export const SECRET_PART_LABEL: Record<string, string> = { username: "아이디", password: "비밀번호", extra: "추가 칸" };

export interface RefLabel {
  label: string;
  kind: "input" | "node" | "param" | "var" | "secret" | "item";
  /** 닿지 않는 참조면 까닭 */
  bad: string | null;
}

/** 참조를 사람 말로 — 「뉴스 읽기 › 제목」 · 「실행 입력 › 주문번호」 · 「🔒 shop · 비밀번호」 */
export function refLabel(flow: Flow, nodeId: string, ref: Ref): RefLabel {
  const tail = (path: readonly string[]) => (path.length ? ` › ${path.join(" › ")}` : "");
  switch (ref.root) {
    case "$input": {
      if (ref.path.length === 0) {
        const from = flow.edges.filter((e) => e.to.node === nodeId).map((e) => flow.nodes.find((n) => n.id === e.from.node)?.name).filter(Boolean);
        return { label: `${from.join(" · ") || "앞 단계"} › 전부`, kind: "input", bad: from.length ? null : "이 노드로 들어오는 단계가 없습니다" };
      }
      const p = producerOf(flow, nodeId, ref.path[0]!);
      return { label: `${p?.name ?? "앞 단계"}${tail(ref.path)}`, kind: "input", bad: p ? null : `앞 단계가 「${ref.path[0]}」를 내놓지 않습니다` };
    }
    case "$node": {
      const n = flow.nodes.find((x) => x.id === ref.path[0]);
      return { label: `${n?.name ?? ref.path[0]}${tail(ref.path.slice(1))}`, kind: "node", bad: n ? null : `노드 「${ref.path[0]}」가 없습니다` };
    }
    case "$params": {
      const p = flow.params.find((x) => x.name === ref.path[0]);
      return { label: `실행 입력 › ${p?.label || ref.path[0]}`, kind: "param", bad: p ? null : `실행 입력 「${ref.path[0]}」가 없습니다` };
    }
    case "$vars":
      return { label: `변수 › ${ref.path[0]}`, kind: "var", bad: ref.path[0]! in flow.vars ? null : `변수 「${ref.path[0]}」가 없습니다` };
    case "$secrets": {
      const s = flow.secrets.find((x) => x.name === ref.path[0]);
      const part = ref.path[1];
      return { label: `🔒 ${ref.path[0]}${part ? ` · ${SECRET_PART_LABEL[part] ?? part}` : ""}`, kind: "secret", bad: s ? null : `시크릿 「${ref.path[0]}」가 없습니다` };
    }
    case "$item":
      return { label: `이 행${tail(ref.path)}`, kind: "item", bad: null };
  }
}

/** 글 속의 {{ }}를 사람 말로 — 「주문번호 칸에 «실행 입력 › 주문번호»를 넣습니다」 */
export function humanTemplate(text: string, flow: Flow, nodeId: string): string {
  return text.replace(/\{\{[^{}]*\}\}/g, (m) => {
    try {
      const s = parseTemplate(m)[0];
      return s?.kind === "ref" ? `«${refLabel(flow, nodeId, s.ref).label}»` : m;
    } catch { return m; }
  });
}

export interface Suggestion { insert: string; label: string; secret: boolean }

/** 값 칸에 넣을 수 있는 것들 — 입력 · 실행 입력 · 변수 · 시크릿 */
export function suggestionsFor(flow: Flow, nodeId: string, withSecrets: boolean): Suggestion[] {
  const s: Suggestion[] = [];
  if (inputsOf(flow, nodeId).length > 1) s.push({ insert: "{{ $input }}", label: "앞 단계 › 전부", secret: false });
  for (const f of inputsOf(flow, nodeId)) s.push({ insert: `{{ $input.${f} }}`, label: `${producerOf(flow, nodeId, f)?.name ?? "앞 노드"} › ${f}`, secret: false });
  for (const p of flow.params) s.push({ insert: `{{ $params.${p.name} }}`, label: `실행 입력 › ${p.label || p.name}`, secret: false });
  for (const v of Object.keys(flow.vars)) s.push({ insert: `{{ $vars.${v} }}`, label: `변수 › ${v}`, secret: false });
  for (const v of flow.sharedVars ?? []) if (!(v in flow.vars)) s.push({ insert: `{{ $vars.${v} }}`, label: `팀 공용 변수 › ${v}`, secret: false });
  if (withSecrets) {
    for (const sec of flow.secrets) {
      const parts = SECRET_PARTS[sec.kind];
      if (parts.length === 0) s.push({ insert: `{{ $secrets.${sec.name} }}`, label: `🔒 ${sec.name}`, secret: true });
      for (const p of parts) s.push({ insert: `{{ $secrets.${sec.name}.${p} }}`, label: `🔒 ${sec.name} · ${SECRET_PART_LABEL[p] ?? p}`, secret: true });
    }
  }
  return s;
}

/** 조건 노드의 출력 포트 — 갈래들 + else */
export const conditionPorts = (cases: readonly ConditionCase[]): { id: string; label: string }[] =>
  [...cases.map((c) => ({ id: c.id, label: c.label || c.id })), { id: ELSE_PORT, label: "그 밖" }];

/** 막힘 갈래의 이름 — 「막힘 · 배송완료」 */
export const blockedLabel = (n: FlowNode): string => `막힘 · ${[...new Set(blockRules(n).flatMap((r) => r.values))].join(", ")}`;

export const portsOf = (n: FlowNode): { id: string; label: string }[] =>
  n.type === "condition" ? conditionPorts(n.config.cases)
  : blockRules(n).length > 0 ? [{ id: OUT_PORT, label: "" }, { id: BLOCKED_PORT, label: blockedLabel(n) }]
  : [{ id: OUT_PORT, label: "" }];

/** to에서 from으로 갈 수 있나 — 이으면 순환이 되는지 미리 본다 */
export function reaches(flow: Flow, from: string, to: string): boolean {
  const stack = [from];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of flow.edges) if (e.from.node === cur) stack.push(e.to.node);
  }
  return false;
}

/** 노드를 어디에 · 무엇과 이어 넣나 */
export type AddRequest =
  | { kind: "after"; node: string; port: string }
  | { kind: "between"; edge: string }
  | { kind: "at"; position: { x: number; y: number } };

const GAP_X = 260;   // 공정 카드 폭(196) + 사이 64
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 150 && Math.abs(a.y - b.y) < 110;

/** 노드를 넣고 잇는다 — n8n처럼 출력 점 뒤 · 엣지 사이 · 빈 곳 */
export function insertNode(flow: Flow, type: NodeChoice, req: AddRequest): { flow: Flow; nodeId: string } {
  const pos = (id: string) => flow.nodes.find((n) => n.id === id)?.position ?? { x: 0, y: 0 };
  let at: { x: number; y: number };
  if (req.kind === "after") {
    const src = flow.nodes.find((n) => n.id === req.node);
    const ports = src ? portsOf(src) : [];
    const i = Math.max(0, ports.findIndex((p) => p.id === req.port));
    const p = pos(req.node);
    at = { x: p.x + GAP_X, y: p.y + (ports.length > 1 ? (i - (ports.length - 1) / 2) * 130 : 0) };
  } else if (req.kind === "between") {
    const e = flow.edges.find((x) => x.id === req.edge);
    const a = pos(e?.from.node ?? ""), b = pos(e?.to.node ?? "");
    at = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
  } else {
    at = req.position;
  }
  // 겹치면 아래로 비킨다
  while (flow.nodes.some((n) => near(n.position, at))) at = { x: at.x, y: at.y + 130 };
  at = { x: Math.round(at.x / 20) * 20, y: Math.round(at.y / 20) * 20 };

  let node = newNode(type, flow, at);
  // 파일 쓰기 노드를 노드 뒤에 붙이면 — 앞 노드가 읽은 목록(표 · 되풀이 목록)을 저장할 값으로 미리 넣어 둔다
  if (node.type === "fileWrite" && req.kind === "after") {
    const src = flow.nodes.find((n) => n.id === req.node);
    const lists = src?.type === "web" ? src.config.actions.flatMap((a) => (a.kind === "readTable" && a.output ? [a.output] : [])) : [];
    const first = lists[0] ?? outputsOf(flow, req.node)[0];
    if (first) node = { ...node, config: { ...node.config, data: `{{ $input.${first} }}` } };
  }
  let nodes = [...flow.nodes, node];
  let edges = flow.edges;
  const eid = (taken: { id: string }[]) => nextId("e", taken.map((x) => x.id));

  if (req.kind === "after") {
    edges = [...edges, { id: eid(edges), from: { node: req.node, port: req.port }, to: { node: node.id } }];
  } else if (req.kind === "between") {
    const e = flow.edges.find((x) => x.id === req.edge);
    if (e) {
      edges = edges.filter((x) => x.id !== e.id);
      edges = [...edges, { id: eid(edges), from: e.from, to: { node: node.id } }];
      edges = [...edges, { id: eid(edges), from: { node: node.id, port: OUT_PORT }, to: e.to }];
      // 사이에 끼웠으면 뒤쪽을 오른쪽으로 민다 — 겹치지 않게
      if (e.to.node && pos(e.to.node).x - at.x < GAP_X) {
        const shift = new Set<string>();
        const stack = [e.to.node];
        while (stack.length) {
          const cur = stack.pop()!;
          if (shift.has(cur) || cur === node.id) continue;
          shift.add(cur);
          for (const x of flow.edges) if (x.from.node === cur) stack.push(x.to.node);
        }
        nodes = nodes.map((n) => (shift.has(n.id) ? { ...n, position: { x: n.position.x + GAP_X, y: n.position.y } } : n));
      }
    }
  }
  return { flow: { ...flow, nodes, edges }, nodeId: node.id };
}

