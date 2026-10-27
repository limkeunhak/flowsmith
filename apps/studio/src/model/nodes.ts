/**
 * 노드 · 동작 만들기 — 새 노드(종류마다 기본 설정) · 새 동작 · id 짓기 · 서버에서 온 초안 고르기(normalize).
 * ★초안은 언제나 **불변 값**으로 다룬다. 고칠 때마다 새 객체를 만든다(React가 바뀐 걸 알게).
 */
import {
  withHttpDefaults, withStoreDefaults, withTransformDefaults, type FileReadConfig, type FlowCallConfig, type Flow, type FlowNode, type HumanDone, type NodeType, type ParamDef, type Target, type WebAction,
} from "@flowsmith/core";
import type { ExtensionMeta } from "../ext-meta.ts";

/** 노드 종류의 이름 — core에 하나(문제 문장 · 알림도 같은 말을 쓴다) */
export { NODE_TYPE_LABEL } from "@flowsmith/core";
import { NODE_TYPE_LABEL } from "@flowsmith/core";

/** 이미 있는 id와 겹치지 않는 다음 id — web1, web2 … */
export function nextId(prefix: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  for (let i = 1; ; i++) if (!set.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

export const emptyTarget = (label = ""): Target => ({ label, locators: [{ kind: "css", value: "" }], fingerprint: null, frames: [], verifiedAt: null });

/**
 * 고를 수 있는 것 — 노드 종류, 또는 워커에 설치된 확장.
 * «human»(사람 기다리기)은 따로 된 종류가 아니라 **사람 기다리기 동작 하나만 든 웹페이지 노드**다(앞 페이지에서 이어서) — 캔버스가 따로 그린다(split.ts webFace)
 */
export type NodeChoice = Exclude<NodeType, "extension"> | "human" | "capture" | "html" | ExtensionMeta;

export function newNode(choice: NodeChoice, flow: Flow, position: { x: number; y: number }): FlowNode {
  if (choice === "human") {
    const id = nextId("web", flow.nodes.map((n) => n.id));
    const hasWeb = flow.nodes.some((n) => n.type === "web");
    return { id, name: "사람 기다리기", position, type: "web", config: { start: hasWeb ? { kind: "continue" } : { kind: "url", url: "" }, actions: [newAction("human", [])] } };
  }
  // 화면 캡처 · HTML 추출 — 앞 페이지에서 이어서 저장 동작 하나(속은 웹페이지 노드)
  if (choice === "capture" || choice === "html") {
    const id = nextId("web", flow.nodes.map((n) => n.id));
    const hasWeb = flow.nodes.some((n) => n.type === "web");
    const save = newAction("save", []) as Extract<WebAction, { kind: "save" }>;
    const action: WebAction = choice === "capture"
      ? { ...save, source: "screenshot", path: "capture/화면.png", skipExisting: false, capture: { area: "full", target: null, format: "png", quality: null, mask: [] } }
      : { ...save, source: "html", path: "html/페이지.html", skipExisting: false, html: { area: "page", target: null } };
    return { id, name: choice === "capture" ? "화면 캡처" : "HTML 추출", position, type: "web", config: { start: hasWeb ? { kind: "continue" } : { kind: "url", url: "" }, actions: [action] } };
  }
  if (typeof choice === "object") {
    const id = nextId("ext", flow.nodes.map((n) => n.id));
    return {
      id, name: choice.title, position, type: "extension",
      config: { extension: choice.id, options: Object.fromEntries(choice.options.map((o) => [o.name, o.default ?? ""])), outputs: [...choice.outputs] },
    };
  }
  const type = choice;
  const id = nextId(type === "condition" ? "cond" : type, flow.nodes.map((n) => n.id));
  const name = `${NODE_TYPE_LABEL[type]} ${id.replace(/\D/g, "")}`;
  switch (type) {
    case "web": {
      const hasWeb = flow.nodes.some((n) => n.type === "web");
      return { id, name, position, type, config: { start: hasWeb ? { kind: "continue" } : { kind: "url", url: "" }, actions: [] } };
    }
    case "condition":
      return { id, name, position, type, config: {
        cases: [{ id: "yes", label: "맞으면", match: "all", rules: [{ left: "", op: "eq", right: "" }], then: { kind: "next" } }],
        else: { then: { kind: "end", status: "success", message: "" } },
      } };
    case "fileWrite":
      return { id, name, position, type, config: {
        data: "",
        target: {
          kind: "file", scope: "flow", dir: "", name: "output", format: "csv", mode: "append", rolling: { kind: "time", unit: "day" },
          csv: { header: true, bom: true, columns: null }, dedupeKey: null, stampColumn: null, keepDays: null,
        },
      } };
    case "fileRead":
      return { id, name, position, type, config: withFileReadDefaults(undefined) };
    case "flowCall":
      return { id, name, position, type, config: withFlowCallDefaults(undefined) };
    case "http":
      return { id, name, position, type, config: withHttpDefaults(undefined) };
    case "transform":
      return { id, name, position, type, config: withTransformDefaults(undefined) };
    case "check":
      return { id, name, position, type, config: { items: [{ id: "k1", label: "", actual: "", op: "notEmpty", expected: null }] } };
    case "approval":
      return { id, name: `승인 ${id.replace(/\D/g, "")}`, position, type, config: { message: "진행해도 될까요?", minRole: "runner", timeoutMin: 24 * 60 } };
    case "custom":
      return { id, name, position, type, config: { code: "// input: 앞 노드의 출력 · page: Playwright Page · ctx: { params, vars, log }\nreturn { };", outputs: [], usesPage: false, timeoutMs: null } };
  }
}

export function newAction(kind: WebAction["kind"], taken: Iterable<string>): WebAction {
  const base = { id: nextId("a", taken), risk: "safe" as const, timeoutMs: null, optional: false };
  switch (kind) {
    case "goto": return { ...base, kind, url: "" };
    case "click": return { ...base, kind, target: emptyTarget(), popup: false };
    case "fill": return { ...base, kind, target: emptyTarget(), value: "" };
    case "select": return { ...base, kind, target: emptyTarget(), value: "" };
    case "check": return { ...base, kind, target: emptyTarget(), checked: true };
    case "press": return { ...base, kind, target: null, key: "Enter" };
    case "wait": return { ...base, kind, wait: { kind: "fixed", ms: 1000 } };
    case "read": return { ...base, kind, target: emptyTarget(), output: "", strategy: "auto", attribute: null, transform: null };
    case "readTable": return { ...base, kind, output: "", table: { label: "", rows: emptyTarget(), columns: [{ name: "", selector: "", strategy: "auto" }], maxRows: 100 } };
    case "closeWindow": return { ...base, kind };
    case "recheck": return { ...base, kind };
    case "switchWindow": return { ...base, kind };
    case "pickRow": return { ...base, kind, pick: { label: "", rows: emptyTarget(), keyColumn: "", keyLabel: "", value: "", click: "", refuse: null } };
    case "assert": return { ...base, kind, target: emptyTarget(), strategy: "auto", equals: "" };
    // 사람 기다리기 — 끝났다는 표시는 녹화로 고르는 것이 쉽다(로그인 화면이 사라지면). 손으로 넣으면 주소부터
    case "human": return { ...base, kind, prompt: "로그인해 주세요", appears: null, done: { kind: "url", pattern: "" } };
    // MetaMask 승인 — 끝났다는 표시(로그인 뒤에만 보이는 것)는 녹화로 고르는 것이 쉽다. 손으로 넣으면 주소부터
    case "walletApprove": return { ...base, kind, done: { kind: "url", pattern: "" } };
    // 파일로 저장 — 주소에서 받기(이 브라우저의 로그인으로)가 기본 · 끊긴 수집을 이어 하게 «이미 있으면 건너뛰기»를 켜 둔다
    case "save": return { ...base, kind, source: "url", url: "", path: "", output: null, skipExisting: true };
  }
}

/** 서버에서 온 초안(틀려 있을 수 있다)을 편집기가 다룰 수 있는 모양으로 */
export function normalize(draft: unknown): Flow {
  const d = (draft ?? {}) as Partial<Flow>;
  return {
    schemaVersion: 1,
    id: d.id ?? "",
    name: d.name ?? "",
    description: d.description ?? "",
    // 실행 입력 — 빠진 칸(종류 · 보기 · 기본값 · 설명)은 검문소와 같은 기본값으로
    params: (d.params ?? []).map((p) => newParam(p)),
    // 옛 이름 «store»(저장 노드)는 파일 쓰기로
    nodes: (d.nodes ?? []).map((n0) => ({ ...n0, type: (n0.type as string) === "store" ? "fileWrite" : n0.type }) as FlowNode).map((n) => ({ ...n, position: n.position ?? { x: 0, y: 0 }, ...(n.type === "fileWrite" ? { config: withStoreDefaults(n.config) } : n.type === "fileRead" ? { config: withFileReadDefaults(n.config) } : n.type === "flowCall" ? { config: withFlowCallDefaults(n.config) } : n.type === "http" ? { config: withHttpDefaults(n.config) } : n.type === "transform" ? { config: withTransformDefaults(n.config) } : {}) }) as FlowNode),
    edges: d.edges ?? [],
    notes: d.notes ?? [],
    vars: d.vars ?? {},
    secrets: (d.secrets ?? []).map((s) => ({ ...s, shared: s.shared ?? false })),
    sharedVars: d.sharedVars ?? [],
    settings: { forbiddenLabels: [], defaultTimeoutMs: 15000, monitorIntervalMin: null, probeParams: {}, browser: "launch", schedules: [], retries: 0, retryDelayMs: 2000, actionPause: { minMs: 0, maxMs: 0 }, runTimeoutMin: 60, locks: [], after: [], fileTriggers: [], ...(d.settings ?? {}), wallet: d.settings?.wallet ?? null,
      // 알림 규칙 — 빠진 칸은 검문소와 같은 기본값(켬 · 처음만)
      notify: (d.settings?.notify ?? []).map((r) => ({ ...r, on: r.on ?? [], url: r.url ?? "", channel: r.channel ?? "slack", attach: r.attach ?? false, firstOnly: r.firstOnly ?? true, enabled: r.enabled ?? true })) },
  };
}

/** 빠진 칸을 기본값으로 — 초안은 검문소를 안 거친 채 저장된다 */
export function withFileReadDefaults(c: Partial<FileReadConfig> | undefined): FileReadConfig {
  const s = (c?.source ?? {}) as Partial<FileReadConfig["source"]>;
  return {
    source: {
      scope: s.scope ?? "otherFlow", flowId: s.flowId ?? null, dir: s.dir ?? "", name: s.name ?? "output", format: s.format ?? "csv",
      pick: s.pick ?? { kind: "latest" }, csv: { header: s.csv?.header ?? true },
    },
    missing: c?.missing ?? "fail",
    maxRows: c?.maxRows ?? null,
  };
}

export function withFlowCallDefaults(c: Partial<FlowCallConfig> | undefined): FlowCallConfig {
  return { flowId: c?.flowId ?? "", version: c?.version ?? "active", items: c?.items ?? "", params: c?.params ?? {}, concurrency: c?.concurrency ?? 1, onError: c?.onError ?? "stop" };
}

export function blankFlow(id: string, name: string): Flow {
  return normalize({ id, name, nodes: [], edges: [] });
}

/**
 * 지금 주소 → 사람 기다리기의 끝 표시(«주소가 이렇게 되면») — 쿼리는 빼고 앞부분이 맞으면.
 * ★`#/…`(해시 라우터 — `/admin/#/orders/…`)는 그 경로가 곧 화면이다 — 버리면 어느 화면에서나 바로 끝난다
 */
export function urlDone(url: string): HumanDone {
  let base = url;
  try {
    const u = new URL(url);
    const route = u.hash.startsWith("#/") ? u.hash.split("?")[0]!.replace(/\/+$/, "") : "";
    base = `${u.origin}${u.pathname}${route}`;
  } catch { /* 그대로 */ }
  return { kind: "url", pattern: `^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` };
}

/** 새 실행 입력 · 빠진 칸 채우기 — 종류는 글자, 필수 */
export function newParam(p: Partial<ParamDef> = {}): ParamDef {
  return { name: p.name ?? "", label: p.label ?? "", required: p.required ?? true, type: p.type ?? "text", options: p.options ?? [], default: p.default ?? "", help: p.help ?? "" };
}
