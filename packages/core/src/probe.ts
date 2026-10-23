/**
 * **변경 감시** — 녹화 때의 요소(지문)와 지금의 요소를 견준다 (PLAN §6). 순수하다.
 *
 * ★무엇을 «바뀜»으로 보나 — 사이트가 바뀌어 플로우가 틀린 것을 누르거나 읽을 수 있는 것만:
 *   - 요소 종류(tag)
 *   - 뜻을 지는 속성: id · name · type · role · aria-label · placeholder · data-testid · href(경로)
 *   - 이름표(nearText — 칸 이름 · 열 머리글)
 *   - 누르는 것의 글자(단추 · 링크) — «조회»가 «삭제»로 바뀌었는데 모르면 안 된다
 * ☆안 보는 것: class(모양만 바뀐다) · **읽는 요소의 글자**(그건 값이다 — 매번 다른 게 정상이다)
 * ★고치지 않는다(결정 3). 알리기만 한다.
 */
import type { Fingerprint, Locator } from "./model.ts";

export const PROBE_STATUSES = ["ok", "changed", "missing", "many"] as const;
export type TargetStatus = (typeof PROBE_STATUSES)[number];

export interface ProbeFinding {
  nodeId: string;
  actionId: string;
  /** 사람 말 — "'조회' 버튼" */
  label: string;
  status: TargetStatus;
  locator: Locator;
  /** 지금 몇 개를 가리키나 */
  count: number;
  /** 무엇이 달라졌나 — 사람 말 */
  differences: string[];
  before: Fingerprint | null;
  now: Fingerprint | null;
  /** 다른 후보들이 지금 몇 개를 가리키나 — 다시 지정할 때 실마리. 자동으로 쓰지 않는다 */
  candidates: { locator: Locator; count: number }[];
}

export interface ProbeReport {
  /** ok: 다 그대로 · changed: 찾기는 했으나 달라진 것이 있다 · broken: 못 찾거나 여러 개 · error: 점검 자체가 못 돌았다 */
  status: "ok" | "changed" | "broken" | "error";
  /** 어디서 왜 멈췄나 — 되돌릴 수 없는 동작 앞 · 끝까지 · 못 찾아서 */
  stop: { nodeId: string | null; actionId: string | null; reason: string };
  findings: ProbeFinding[];
  /** 살펴본 요소 수 */
  checked: number;
  message: string;
}

const KEY_ATTRS = ["id", "name", "type", "role", "aria-label", "placeholder", "data-testid", "href"] as const;
const ATTR_LABEL: Record<(typeof KEY_ATTRS)[number], string> = {
  id: "id", name: "name", type: "종류(type)", role: "역할", "aria-label": "접근성 이름", placeholder: "안내 글자", "data-testid": "테스트 id", href: "링크 주소",
};

const norm = (s: string | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
/** 링크는 경로만 본다 — 쿼리 · 세션 값은 매번 다르다 */
const path = (href: string): string => { try { return new URL(href, "http://x").pathname; } catch { return href.split("?")[0] ?? href; } };
const short = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);

/**
 * 지문을 견준다. `readsValue`면 요소의 글자는 보지 않는다(읽는 값이다).
 * 녹화 때 지문이 없으면(손으로 적은 위치) 견줄 것이 없다 — 있는지만 본다.
 */
export function compareFingerprint(before: Fingerprint | null, now: Fingerprint, readsValue: boolean): string[] {
  if (before === null) return [];
  const diffs: string[] = [];
  if (before.tag !== now.tag) diffs.push(`요소 종류: ${before.tag} → ${now.tag}`);
  for (const k of KEY_ATTRS) {
    const a = before.attrs[k], b = now.attrs[k];
    if (a === undefined && b === undefined) continue;
    const x = k === "href" ? path(a ?? "") : norm(a), y = k === "href" ? path(b ?? "") : norm(b);
    if (x !== y) diffs.push(`${ATTR_LABEL[k]}: ${x ? `'${short(x)}'` : "없음"} → ${y ? `'${short(y)}'` : "없음"}`);
  }
  if (!readsValue && norm(before.text) !== norm(now.text)) diffs.push(`글자: '${short(norm(before.text))}' → '${short(norm(now.text))}'`);
  if (norm(before.nearText) && norm(before.nearText) !== norm(now.nearText) && !(readsValue && norm(now.nearText).includes(norm(before.nearText)))) {
    diffs.push(`이름표: '${short(norm(before.nearText))}' → '${short(norm(now.nearText)) || "없음"}'`);
  }
  return diffs;
}

/** 발견들 → 보고서 상태 */
export function reportStatus(findings: readonly ProbeFinding[]): ProbeReport["status"] {
  if (findings.some((f) => f.status === "missing" || f.status === "many")) return "broken";
  if (findings.some((f) => f.status === "changed")) return "changed";
  return "ok";
}
