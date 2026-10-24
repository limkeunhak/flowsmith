/**
 * **점검 실행** — 요소가 녹화 때와 같은지 살핀다 (PLAN §6).
 *
 * ★점검은 «되돌릴 수 없는 동작»을 누르지 않는다. 그 요소가 있는지만 보고 거기서 멈춘다.
 * ★고치지 않는다(결정 3) — 알리기만 한다. 후보는 붙이기만 한다.
 */
import type { Page } from "playwright";
import { compareFingerprint, reportStatus, type Fingerprint, type ProbeFinding, type ProbeReport, type Target, type WebAction } from "@flowsmith/core";
import { build, candidatesOf, rootOf } from "./browser/locate.ts";

/** 점검을 여기서 멈춘다 — 실패가 아니다 */
export class ProbeStop extends Error {
  readonly nodeId: string;
  readonly actionId: string | null;
  constructor(nodeId: string, actionId: string | null, reason: string) {
    super(reason);
    this.name = "ProbeStop";
    this.nodeId = nodeId;
    this.actionId = actionId;
  }
}

/**
 * 페이지 안에서 지문을 뜬다 — ★레코더(packages/recorder/src/inject.js)의 fingerprint · nearText와 **같은 규칙**이어야 한다.
 * 다르면 아무것도 안 바뀌어도 «바뀜»이 뜬다. 한쪽을 고치면 다른 쪽도 고친다.
 * (페이지로 보내지는 함수라 바깥 이름을 쓸 수 없다 — 안에 다 있다)
 */
const fingerprintIn = (el: any): Fingerprint => {
  const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
  const labelOwnText = (label: any) => {
    const c = label.cloneNode(true);
    c.querySelectorAll("select,textarea,input,button,option").forEach((n: any) => n.remove());
    return norm(c.textContent);
  };
  const labelText = (e: any) => {
    const by = e.getAttribute && e.getAttribute("aria-labelledby");
    if (by) return norm(by.split(/\s+/).map((id: string) => (e.ownerDocument.getElementById(id) || {}).textContent || "").join(" "));
    if (e.labels && e.labels.length) return norm(Array.from(e.labels).map(labelOwnText).join(" "));
    return "";
  };
  const nearText = (e: any) => {
    const lt = labelText(e);
    if (lt) return lt.slice(0, 60);
    const cell = e.closest && e.closest("td, th");
    const table = cell && cell.closest("table");
    if (cell && table) {
      const i = Array.from(cell.parentElement.children).indexOf(cell);
      const head = table.querySelectorAll("thead tr:last-child > *")[i];
      if (head && norm(head.textContent)) return norm(head.textContent).slice(0, 60);
    }
    const p = e.previousElementSibling;
    if (p && norm(p.textContent)) return norm(p.textContent).slice(0, 60);
    // ★부모의 **자기 글자**만 — 자식들 글자까지 넣으면 옆 단추의 글자가 바뀌어도 이 요소가 «바뀜»이 된다
    return e.parentElement ? norm(Array.from(e.parentElement.childNodes).filter((n: any) => n.nodeType === 3).map((n: any) => n.textContent).join(" ")).slice(0, 60) : "";
  };
  const attrs: Record<string, string> = {};
  for (const a of ["id", "name", "type", "class", "role", "aria-label", "placeholder", "href", "data-testid", "title", "alt", "value"]) {
    const v = el.getAttribute(a);
    if (v !== null && !(a === "value" && el.type === "password")) attrs[a] = v.slice(0, 120);
  }
  const secret = el.type === "password";
  return { tag: el.tagName.toLowerCase(), attrs, text: secret ? "" : norm(el.innerText || el.textContent).slice(0, 80), nearText: nearText(el) };
};

/** 동작이 건드리는 요소들 — 읽는 것인가(글자는 값이다) · 여러 개가 정상인가(표의 행) */
export function probeTargets(a: WebAction): { target: Target; readsValue: boolean; many: boolean }[] {
  switch (a.kind) {
    case "click": case "check": return [{ target: a.target, readsValue: false, many: false }];
    case "fill": case "select": return [{ target: a.target, readsValue: true, many: false }];   // 칸의 글자는 넣은 값이다
    case "press": return a.target ? [{ target: a.target, readsValue: true, many: false }] : [];
    case "read": case "assert": return [{ target: a.target, readsValue: true, many: false }];
    case "pickRow": return [{ target: a.pick.rows, readsValue: true, many: true }];
    case "readTable": return [{ target: a.table.rows, readsValue: true, many: true }];
    case "wait": return a.wait.kind === "visible" || a.wait.kind === "filled" ? [{ target: a.wait.target, readsValue: true, many: false }] : [];
    case "goto": case "closeWindow": case "human": case "walletApprove": return [];   // 사람 기다리기 · MetaMask 승인 — 점검은 그 앞에서 멈춘다(web-node.ts)
  }
}

export async function inspectTarget(page: Page, t: { target: Target; readsValue: boolean; many: boolean }, timeoutMs: number): Promise<Omit<ProbeFinding, "nodeId" | "actionId">> {
  const locator = t.target.locators[0]!;
  const loc = build(rootOf(page, t.target.frames), locator);
  await loc.first().waitFor({ state: "attached", timeout: timeoutMs }).catch(() => undefined);
  const count = await loc.count().catch(() => 0);
  const base = { label: t.target.label, locator, count, before: t.target.fingerprint, candidates: [] as ProbeFinding["candidates"] };
  if (count === 0 || (count > 1 && !t.many)) {
    return { ...base, status: count === 0 ? "missing" : "many", differences: [count === 0 ? "지금 페이지에 없습니다" : `${count}개를 가리킵니다`], now: null, candidates: await candidatesOf(page, t.target) };
  }
  const now = await loc.first().evaluate(fingerprintIn).catch(() => null);
  const differences = now ? compareFingerprint(t.target.fingerprint, now, t.readsValue) : [];
  return { ...base, status: differences.length ? "changed" : "ok", differences, now };
}

/** 점검 보고서 — 발견 · 멈춘 자리 · 실행 자체가 실패했으면 그것까지 */
export function probeReport(findings: ProbeFinding[], stop: ProbeStop | null, failure: string | null): ProbeReport {
  const bad = findings.filter((f) => f.status !== "ok").length;
  const status = failure !== null && bad === 0 ? "error" : reportStatus(findings);
  return {
    status,
    stop: stop ? { nodeId: stop.nodeId, actionId: stop.actionId, reason: stop.message }
      : { nodeId: null, actionId: null, reason: failure ?? "끝까지 살펴봤습니다" },
    findings,
    checked: findings.length,
    message: status === "ok" ? `요소 ${findings.length}개가 녹화 때와 같습니다`
      : status === "error" ? `점검이 끝까지 돌지 못했습니다 — ${failure}`
      : `요소 ${findings.length}개 중 ${bad}개가 달라졌습니다`,
  };
}
