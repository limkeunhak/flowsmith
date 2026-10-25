/**
 * **AI가 낸 워크플로우를 진짜로** — 빠진 칸은 노드 종류의 기본값(model/nodes.ts)으로 채우고, 검문소(core checkFlow)로 본다.
 *
 *   막는 것   커스텀 코드 노드(새로 만들기 · 고치기 — 있던 것은 그대로 둘 때만) · 설치 안 된 확장 · 모양이 틀린 것 · 검문소 문제
 *   할 일     웹페이지 동작의 요소는 AI가 지어내지 않는다 — `from`(ai/refs.ts의 검증된 요소)이면 그 요소를 그대로 옮기고,
 *            아니면 이름만 있는 빈 자리. 검문소에는 임시 선택자를 넣어 보고(뒤 노드의 $input 검사가 돌게),
 *            제안에는 비워 둔다 → 편집 화면이 «녹화로 채우세요»로 보인다
 */
import { checkFlow, NODE_TYPES, type Flow, type FlowNode, type NodeType, type WebAction } from "@flowsmith/core";
import type { ExtensionMeta } from "../ext-meta.ts";
import { emptyTarget, newAction, newNode, newParam, nextId, normalize } from "../model/index.ts";
import type { RefElement } from "./refs.ts";

export interface BuildContext {
  /** 고치는 중인 초안 — 새로 만들면 null */
  draft: Flow | null;
  extensions: ExtensionMeta[];
  /** 새 워크플로우의 id */
  newId: string;
  /** 다시 쓸 수 있는 요소 — 동작의 from이 가리킨다(목록에 없는 것은 받지 않는다) */
  refs?: Map<string, RefElement>;
}

export interface Built {
  flow: Flow | null;
  /** AI가 고쳐야 할 것 — 있으면 받지 않는다 */
  problems: string[];
  /** 사람이 녹화로 채울 자리 — «노드 › 이름» */
  todo: string[];
}

const TODO_CSS = "flowsmith-ai-todo";
/** AI가 낼 수 있는 웹 동작 — catalog의 ACTION_DOCS와 같아야 한다(ai-catalog 시험) */
export const WEB_KINDS = new Set(["goto", "click", "fill", "select", "read", "readTable", "wait", "press", "human"]);
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);

/** 얕게 두 겹까지 — 기본값 위에 AI가 준 칸만(목록은 통째로 바꾼다) */
function merge(base: Obj, over: Obj): Obj {
  const out: Obj = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? { ...(base[k] as Obj), ...v } : v;
  return out;
}

/** 웹 동작 — from이면 검증된 요소를 옮기고, 아니면 빈 자리(요소는 녹화로) */
function webAction(raw: Obj, taken: string[], problems: string[], where: string, refs?: Map<string, RefElement>): WebAction | null {
  const kind = str(raw["kind"]);
  if (!WEB_KINDS.has(kind)) { problems.push(`${where}: 웹 동작 «${kind}»는 쓸 수 없습니다 — ${[...WEB_KINDS].join(" · ")}`); return null; }
  const a = newAction(kind as WebAction["kind"], taken) as WebAction & Obj;
  taken.push(a.id);
  const from = str(raw["from"]);
  const ref = from ? refs?.get(from) : undefined;
  if (from && !ref) { problems.push(`${where}: from «${from}»은 «다시 쓸 수 있는 요소» 목록에 없습니다 — 목록의 ref만 쓰거나 from 없이 이름만 두세요`); return null; }
  const label = str(raw["label"]) || ref?.label || "";
  if ("target" in a && a.target) {
    if (ref && !ref.target && kind !== "readTable") { problems.push(`${where}: from «${from}»은 표라 ${kind}에 쓸 수 없습니다 — readTable로 쓰세요`); return null; }
    (a as { target: unknown }).target = ref?.target ? { ...structuredClone(ref.target), label } : emptyTarget(label);
  }
  switch (a.kind) {
    case "goto": a.url = str(raw["url"]); break;
    case "fill": case "select": a.value = str(raw["value"], ref?.value ?? ""); break;
    case "read": a.output = str(raw["output"], ref?.output ?? ""); break;
    case "readTable": {
      a.output = str(raw["output"]);
      if (ref?.table) { a.table = { ...structuredClone(ref.table), label: label || ref.table.label }; break; }
      if (ref) { problems.push(`${where}: from «${from}»은 표가 아닙니다 — readTable에는 표(«표 · 열 …») ref만`); return null; }
      const cols = Array.isArray(raw["columns"]) ? raw["columns"].map((c) => (typeof c === "string" ? c : str((c as Obj)?.["name"]))).filter(Boolean) : [];
      a.table = { ...a.table, label, rows: emptyTarget(label), columns: (cols.length ? cols : ["값"]).map((name) => ({ name, selector: "", strategy: "auto" as const })) };
      break;
    }
    case "wait": a.wait = { kind: "fixed", ms: typeof raw["ms"] === "number" ? raw["ms"] : 1000 }; break;
    case "press": a.key = str(raw["key"], "Enter"); break;
    case "human": a.prompt = str(raw["prompt"]) || label || "로그인해 주세요"; break;
    default: break;
  }
  if (a.kind === "click" && raw["popup"] === true) a.popup = true;
  return a;
}

/** 위치 — 앞에서부터 왼쪽→오른쪽, 같은 깊이는 아래로 */
function layout(nodes: FlowNode[], edges: { from: string; to: string }[], keep: Map<string, { x: number; y: number }>): void {
  const depth = new Map<string, number>();
  const ins = new Map<string, string[]>();
  for (const e of edges) ins.set(e.to, [...(ins.get(e.to) ?? []), e.from]);
  const d = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const v = Math.max(-1, ...(ins.get(id) ?? []).map((p) => d(p, seen))) + 1;
    depth.set(id, v);
    return v;
  };
  const rows = new Map<number, number>();
  // ★있던 노드는 그 자리 · 새 노드는 앞 노드의 오른쪽(없으면 깊이대로) — 이미 놓인 노드와 겹치면 아래로 비킨다
  const placed: { x: number; y: number }[] = [];
  for (const n of nodes) { const old = keep.get(n.id); if (old) { n.position = old; placed.push(old); } }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const clash = (p: { x: number; y: number }) => placed.some((q) => Math.abs(q.x - p.x) < 200 && Math.abs(q.y - p.y) < 150);
  for (const n of nodes) {
    if (keep.has(n.id)) continue;
    const parent = (ins.get(n.id) ?? []).map((id) => byId.get(id)).find((p) => p && (keep.has(p.id) || placed.includes(p.position)));
    const col = d(n.id);
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    const at = parent ? { x: parent.position.x + 260, y: parent.position.y } : { x: col * 260, y: row * 180 };
    while (clash(at)) at.y += 180;
    n.position = at;
    placed.push(at);
  }
}

export function buildProposal(raw: unknown, ctx: BuildContext): Built {
  const problems: string[] = [];
  if (!isObj(raw)) return { flow: null, problems: ["flow가 객체가 아닙니다"], todo: [] };
  const old = ctx.draft;
  const oldById = new Map((old?.nodes ?? []).map((n) => [n.id, n]));
  const rawNodes = Array.isArray(raw["nodes"]) ? raw["nodes"] : [];
  if (rawNodes.length === 0) problems.push("nodes가 비었습니다 — 노드를 하나 이상 넣으세요");
  const base: Flow = old ? structuredClone(old) : normalize({ id: ctx.newId, name: "" });
  const nodes: FlowNode[] = [];
  const ids = new Set<string>();
  rawNodes.forEach((rn, i) => {
    const where = `nodes[${i}]`;
    if (!isObj(rn)) { problems.push(`${where}: 객체가 아닙니다`); return; }
    const type = str(rn["type"]) as NodeType;
    let id = str(rn["id"]);
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id) || ids.has(id)) id = nextId(type === "condition" ? "cond" : type || "node", [...ids]);
    ids.add(id);
    const name = str(rn["name"]) || id;
    const cfg = isObj(rn["config"]) ? rn["config"] : {};
    const prev = oldById.get(id);
    if (!(NODE_TYPES as readonly string[]).includes(type)) { problems.push(`${where}(${name}): 노드 종류 «${type}»는 없습니다 — ${NODE_TYPES.filter((t) => t !== "custom").join(" · ")}`); return; }
    // ★커스텀 코드 — 있던 것을 그대로 둘 때만(관리 정책)
    if (type === "custom") {
      if (prev?.type === "custom") { nodes.push({ ...prev, name }); return; }
      problems.push(`${where}(${name}): 커스텀 코드 노드는 만들 수 없습니다(관리 정책) — 값 다듬기 · 조건 · HTTP 노드로 바꾸세요`);
      return;
    }
    if (prev?.type === "custom") { problems.push(`${where}(${name}): 커스텀 코드 노드 «${prev.name}»는 바꿀 수 없습니다 — 그대로 두세요`); return; }
    if (type === "extension") {
      const ext = ctx.extensions.find((e) => e.id === str(cfg["extension"]));
      if (!ext) { problems.push(`${where}(${name}): 확장 «${str(cfg["extension"])}»가 이 서버에 없습니다 — 있는 것: ${ctx.extensions.map((e) => e.id).join(", ") || "없음"}`); return; }
      const n = newNode(ext, base, { x: 0, y: 0 }) as FlowNode & { config: Obj };
      nodes.push({ ...n, id, name, config: { ...n.config, options: { ...(n.config["options"] as Obj), ...(isObj(cfg["options"]) ? cfg["options"] : {}) } } } as FlowNode);
      return;
    }
    const fresh = newNode(type as Exclude<NodeType, "extension">, base, { x: 0, y: 0 });
    if (type === "web") {
      const prevWeb = prev?.type === "web" ? prev : null;
      const taken: string[] = [];
      const actions = (Array.isArray(cfg["actions"]) ? cfg["actions"] : []).flatMap((ra, j): WebAction[] => {
        if (!isObj(ra)) return [];
        // 있던 동작(녹화한 것)은 그대로 — id가 같으면 요소를 지키고 이름 · 값만 받는다
        const kept = prevWeb?.config.actions.find((a) => a.id === str(ra["id"]));
        if (kept) {
          taken.push(kept.id);
          const k = structuredClone(kept) as WebAction & Obj;
          if ("value" in k && typeof ra["value"] === "string") k.value = ra["value"];
          if ("output" in k && typeof ra["output"] === "string") k.output = ra["output"];
          return [k];
        }
        const a = webAction(ra, taken, problems, `${where}(${name}).actions[${j}]`, ctx.refs);
        return a ? [a] : [];
      });
      const start = isObj(cfg["start"]) ? cfg["start"] : (fresh.config as { start: unknown }).start;
      nodes.push({ id, type: "web", name, position: { x: 0, y: 0 }, config: { start: start as never, actions } } as FlowNode);
      return;
    }
    nodes.push({ ...fresh, id, name, config: merge(fresh.config as unknown as Obj, cfg) } as unknown as FlowNode);
  });

  // 선 — { from, to, port }
  const rawEdges = Array.isArray(raw["edges"]) ? raw["edges"] : [];
  const edges = rawEdges.flatMap((re, i) => {
    if (!isObj(re)) return [];
    const from = str(re["from"]) || str((re["from"] as Obj | undefined)?.["node"]);
    const to = str(re["to"]) || str((re["to"] as Obj | undefined)?.["node"]);
    if (!ids.has(from) || !ids.has(to)) { problems.push(`edges[${i}]: «${from}» → «${to}» — 없는 노드입니다`); return []; }
    return [{ id: `e${i + 1}`, from: { node: from, port: str(re["port"]) || str((re["from"] as Obj | undefined)?.["port"]) || "out" }, to: { node: to } }];
  });
  layout(nodes, edges.map((e) => ({ from: e.from.node, to: e.to.node })), new Map((old?.nodes ?? []).map((n) => [n.id, n.position])));

  // 메모 — 그 노드 위에
  const notes = (Array.isArray(raw["notes"]) ? raw["notes"] : []).flatMap((rn, i) => {
    if (!isObj(rn) || !str(rn["text"]).trim()) return [];
    const near = nodes.find((n) => n.id === str(rn["near"]));
    const at = near ? { x: near.position.x - 60, y: near.position.y - 170 } : { x: 0, y: -200 - i * 160 };
    return [{ id: `m${i + 1}`, text: str(rn["text"]).slice(0, 2000), position: at, width: 240, height: 130, color: "yellow" as const }];
  });

  const s = isObj(raw["settings"]) ? raw["settings"] : {};
  const flow = normalize({
    ...base,
    name: str(raw["name"]) || base.name || "AI가 만든 워크플로우",
    description: str(raw["description"], base.description),
    params: Array.isArray(raw["params"]) ? raw["params"].filter(isObj).map((p) => newParam(p as never)) : base.params,
    secrets: Array.isArray(raw["secrets"]) ? raw["secrets"].filter(isObj).map((x) => ({ name: str(x["name"]), kind: x["kind"] === "login" ? "login" : "text", description: str(x["description"]), shared: x["shared"] === true })) : base.secrets,
    vars: isObj(raw["vars"]) ? Object.fromEntries(Object.entries(raw["vars"]).map(([k, v]) => [k, String(v)])) : base.vars,
    nodes, edges,
    notes: raw["notes"] === undefined ? base.notes : notes,
    settings: {
      ...base.settings,
      ...(Array.isArray(s["schedules"]) ? { schedules: s["schedules"] as never } : {}),
      ...(Array.isArray(s["notify"]) ? { notify: (s["notify"] as Obj[]).map((r, i) => ({ id: str(r["id"], `n${i + 1}`), on: r["on"] ?? ["failure"], channel: r["channel"] ?? "slack", url: str(r["url"], base.settings.notify.find((x) => x.id === r["id"])?.url ?? ""), attach: false, firstOnly: true, enabled: r["enabled"] !== false })) as never } : {}),
    },
  });

  // 할 일 — 요소가 빈 웹 동작. 검문소에는 임시 선택자로
  const todo: string[] = [];
  const probe = structuredClone(flow);
  for (const n of probe.nodes) {
    if (n.type !== "web") continue;
    for (const a of n.config.actions) {
      const t = "target" in a ? a.target : null;
      if (t && t.locators.every((l) => !l.value)) { todo.push(`${n.name} › ${t.label || a.kind}`); t.locators = [{ kind: "css", value: TODO_CSS }]; }
      // 사람 기다리기 — «끝났다는 표시»는 녹화로(로그인 화면이 사라지면 · 주소가 되면)
      if (a.kind === "human" && a.done.kind === "url" && !a.done.pattern) { todo.push(`${n.name} › ${a.prompt || "사람 기다리기"}(끝 표시)`); a.done = { kind: "url", pattern: "^https://flowsmith-ai-todo" }; }
      if (a.kind === "readTable") {
        if (a.table.rows.locators.every((l) => !l.value)) { todo.push(`${n.name} › ${a.table.label || "표"}`); a.table.rows.locators = [{ kind: "css", value: TODO_CSS }]; }
        for (const c of a.table.columns) if (!c.selector) c.selector = TODO_CSS;
      }
    }
  }
  if (problems.length === 0) problems.push(...checkFlow(probe));
  return { flow: problems.length ? null : flow, problems, todo: [...new Set(todo)] };
}
