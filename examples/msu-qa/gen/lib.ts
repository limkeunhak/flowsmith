/**
 * 워크플로우 JSON을 짓는 손 — 서비스 파일(msuweb.ts …)이 이것으로 시나리오를 적고, main.ts가 flows/ · suites/에 쓴다.
 *
 *   웹페이지 노드(열고 · 읽고) → (필요하면 커스텀 노드) → 검사 노드(판정)
 *
 * ★대상은 «정확히 하나»여야 한다(엔진이 여러 개면 멈춘다) — 둘 잡히면 id · :visible · xpath (…)[1]로 좁힌다.
 * ★«보인다»는 «있을 때만»(2초) 읽고 검사 «비어 있지 않다» — 없으면 오류가 아니라 불통과로 남는다.
 */
export const WEB = "https://qa.msu.io";
export const NAV = `${WEB}/navigator`;
export const MARKET = `${WEB}/marketplace`;
export const SWAP = `${WEB}/swapnwarp`;

/** 화면에 나오면 안 되는 내부 정보 — 원본 src/utils/error-leaks.ts와 같은 목록 */
export const LEAKS = ["TypeError", "ReferenceError", "at Object.", "ECONNREFUSED", "ETIMEDOUT", "Internal Server", "stacktrace", "Traceback"];

type Json = any;
export type LocatorKind = "testid" | "role" | "label" | "placeholder" | "text" | "css" | "xpath";

let seq = 0;
const id = (p: string) => `${p}${++seq}`;

/** 대상 — 위치 후보 하나 */
export const T = (label: string, kind: LocatorKind, value: string, name?: string): Json =>
  ({ label, locators: [{ kind, value, ...(name ? { name } : {}) }], fingerprint: null, frames: [], verifiedAt: null });

const base = (kind: string, extra: Json = {}): Json => ({ id: id("a"), kind, risk: "safe", timeoutMs: null, optional: false, ...extra });
export const goto = (url: string) => base("goto", { url });
export const pause = (ms: number) => base("wait", { wait: { kind: "fixed", ms } });
export const waitUrl = (pattern: string, timeoutMs = 15000) => base("wait", { wait: { kind: "url", pattern }, timeoutMs });
export const waitVisible = (target: Json, timeoutMs = 15000) => base("wait", { wait: { kind: "visible", target }, timeoutMs });
/** 새로고침하며 보일 때까지 — 다른 실행 · 다른 지갑이 바꾼 것(올린 매물 · 정산) */
export const waitVisibleReloading = (target: Json, everyMs: number, timeoutMs: number) => base("wait", { wait: { kind: "visible", target, reloadEveryMs: everyMs }, timeoutMs });
/** MetaMask 승인 — 끝 표시가 맞을 때까지 뜨는 승인 창을 누른다(지갑 브라우저만). 처음부터 맞으면 아무것도 누르지 않는다 */
export const walletApprove = (done: Json, timeoutMs = 120000, atLeast?: number) => base("walletApprove", { done, timeoutMs, ...(atLeast ? { atLeast } : {}) });
/** 새로고침하며 사라질 때까지 */
export const waitHiddenReloading = (target: Json, everyMs: number, timeoutMs: number) => base("wait", { wait: { kind: "hidden", target, reloadEveryMs: everyMs }, timeoutMs });
export const visible = (target: Json) => ({ kind: "visible", target });
export const hidden = (target: Json) => ({ kind: "hidden", target });
export const click = (target: Json, optional = false) => base("click", { target, popup: false, optional });
export const fill = (target: Json, value: string) => base("fill", { target, value });
export const press = (target: Json | null, key: string) => base("press", { target, key });
/** 읽기 — 기본은 «있을 때만»(없으면 값이 비어 불통과로) */
export const read = (output: string, target: Json, { optional = true, strategy = "innerText", attribute = null as string | null } = {}) =>
  base("read", { target, output, strategy, attribute, transform: null, optional });
/** 쿠키 배너 «Accept All Cookies» — 있을 때만 */
export const cookie = () => click(T("쿠키 «Accept All Cookies»", "css", 'button:has-text("Accept All Cookies")'), true);

export type CheckOp =
  | "eq" | "ne" | "contains" | "notContains" | "startsWith" | "endsWith" | "matches" | "empty" | "notEmpty"
  | "gt" | "gte" | "lt" | "lte" | "isTrue" | "isFalse" | "countEq" | "countGte" | "countLte" | "anyEq" | "anyContains";
export const check = (label: string, actual: string, op: CheckOp, expected: string | null = null) => ({ id: id("k"), label, actual, op, expected });
export const noLeak = (ref: string) => LEAKS.map((l) => check(`«${l}»가 노출되지 않는다`, ref, "notContains", l));

export const web = (nodeId: string, name: string, actions: Json[], start: Json = { kind: "continue" }): Json =>
  ({ id: nodeId, type: "web", name, position: { x: 0, y: 0 }, config: { start, actions } });
export const openAt = (url: string) => ({ kind: "url", url });
/** 커스텀 노드 — (input, page, ctx) 몸통. page는 날 Playwright Page, ctx.params가 실행 입력 */
export const custom = (nodeId: string, name: string, code: string | string[], outputs: string[], usesPage = true): Json =>
  ({ id: nodeId, type: "custom", name, position: { x: 0, y: 0 }, config: { code: Array.isArray(code) ? code.join("\n") : code, outputs, usesPage, timeoutMs: 60000 } });
/** 다른 워크플로우 실행 — 게시된 버전을 한 번(행 없이) */
export const call = (nodeId: string, name: string, flowId: string, params: Record<string, string>, onError: "stop" | "continue" = "continue"): Json =>
  ({ id: nodeId, type: "flowCall", name, position: { x: 0, y: 0 }, config: { flowId, version: "active", items: "", params, concurrency: 1, onError } });
/** 조건 — 규칙이 맞으면 그 자리에서 끝낸다(status · 까닭), 아니면 이어 간다 */
export const endIf = (nodeId: string, name: string, rules: { left: string; op: string; right?: string | null }[], status: "success" | "failure", message: string, match: "all" | "any" = "any"): Json =>
  ({ id: nodeId, type: "condition", name, position: { x: 0, y: 0 }, config: {
    cases: [{ id: "stop", label: message, match, rules: rules.map((r) => ({ left: r.left, op: r.op, right: r.right ?? null })), then: { kind: "end", status, message } }],
    else: { then: { kind: "next" } },
  } });
export const judge = (items: Json[]): Json => ({ id: "judge", type: "check", name: "판정", position: { x: 0, y: 0 }, config: { items } });
/** 지금 주소 · 경로 · 제목 — 웹페이지 동작에 없어서 코드로 */
export const where = (nodeId = "where") =>
  custom(nodeId, "지금 주소", "return { path: new URL(page.url()).pathname, url: decodeURIComponent(page.url()), title: await page.title() };", ["path", "url", "title"]);

export interface Param { name: string; label: string; default?: string; help?: string; type?: "text" | "select"; options?: string[]; required?: boolean }
export interface Flow { id: string; [k: string]: Json }

/** 노드를 차례로 잇는다(앞 노드의 out → 다음 · 조건이면 «그 밖» → 다음 — 맞는 갈래는 그 자리에서 끝난다) */
export function flow(flowId: string, name: string, description: string, nodes: Json[], params: Param[] = [], more: { settings?: Json; secrets?: Json[] } = {}): Flow {
  nodes.forEach((nd, i) => (nd.position = { x: i * 300, y: 0 }));
  const edges = nodes.slice(1).map((nd, i) => ({ id: `e${i + 1}`, from: { node: nodes[i].id, port: nodes[i].type === "condition" ? "else" : "out" }, to: { node: nd.id } }));
  return {
    schemaVersion: 1, id: flowId, name, description,
    params: params.map((p) => ({ name: p.name, label: p.label, required: p.required ?? true, type: p.type ?? "text", options: p.options ?? [], default: p.default ?? "", help: p.help ?? "" })),
    vars: {}, secrets: more.secrets ?? [], settings: { defaultTimeoutMs: 20000, forbiddenLabels: [], ...more.settings }, nodes, edges,
  };
}

/** Suite 시나리오 하나 — 원본 test() 하나 */
export interface Item { id: string; flowId: string; label: string; params: Record<string, string>; enabled: boolean }
export const item = (itemId: string, flowId: string, label: string, params: Record<string, string> = {}): Item =>
  ({ id: itemId, flowId, label, params, enabled: true });

/** 서비스 파일이 내놓는 것 */
export interface Service {
  /** suites/<file>.json */
  file: string;
  suite: { name: string; description: string };
  flows: Flow[];
  items: Item[];
  /** 옮기지 못한 시나리오 · 옮겼지만 원본과 다른 것 — README에 옮겨 적는다 */
  notes: string[];
}

/** 서비스 파일을 나눠 적을 때 한 조각 — 서비스 파일이 합친다 */
export type Part = Pick<Service, "flows" | "items" | "notes">;
export const merge = (svc: Service, ...parts: Part[]) => {
  for (const p of parts) { svc.flows.push(...p.flows); svc.items.push(...p.items); svc.notes.push(...p.notes); }
};
