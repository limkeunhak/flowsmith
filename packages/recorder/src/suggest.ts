/**
 * **녹화 제안** — 녹화한 요소에 이름을 짓고, 위치를 고르고, 다르게 남길 길(행 고르기 · 목록)을 제안하는 순수 함수들.
 * 세션(session.ts)이 쓰고, 시험이 따로 부른다.
 */
import type { Locator, Target } from "@flowsmith/core";

/**
 * 읽을 요소의 이름 — ★요소의 **내용**(「배송중」)으로 부르면 안 된다. 값이 바뀌면 이름도 틀린다.
 * 둘레 글자(「상태: 배송중」)에서 제 내용을 뺀 것(「상태」)을 쓴다.
 */
export function readLabel(raw: { label: string; fingerprint: Target["fingerprint"] }): string {
  const own = raw.fingerprint?.text ?? "";
  const near = (raw.fingerprint?.nearText ?? "").replace(own, "").replace(/[:：\-–—·|]+\s*$/u, "").replace(/\s+/g, " ").trim();
  if (near && near.length <= 30 && near !== own) return near;
  // 둘레 글자가 없다 — 요소의 이름이 곧 내용이면(뉴스 제목 · 바뀌는 값) 내용으로 부르지 않는다
  const key = own.slice(0, 15);
  if (raw.label.length > 30 || (key && raw.label.includes(key))) return "값";
  return raw.label;
}

/**
 * 읽을 요소를 **내용으로** 찾는 위치는 버린다 — 「[날씨] 내일 기온 올라」를 글자로 찾으면 내일은 없다.
 * 읽기는 바뀌는 값을 읽는 동작이다. 구조(css)로 찾는다.
 */
export function withoutContentLocators<T extends { candidates: Locator[]; fingerprint: Target["fingerprint"] }>(raw: T): T {
  const own = (raw.fingerprint?.text ?? "").trim();
  if (!own) return raw;
  const byContent = (l: Locator) =>
    l.kind === "text" || (l.kind === "role" && !!l.name && (l.name === own || (l.name.length >= 8 && own.includes(l.name))));
  const kept = raw.candidates.filter((l) => !byContent(l));
  return kept.length ? { ...raw, candidates: kept } : raw;
}

/**
 * 키로 쓸 칸 — 「번호 · 코드 · ID」가 이름에 든 칸, 없으면 누른 칸이 아닌 첫 글자 있는 칸.
 * ★행 번호로 고르면 목록 순서가 바뀔 때 다른 행을 누른다 — 키 칸의 글자로 고른다.
 */
export function keyColumnOf(row: { click: string; columns: { name: string; selector: string; text: string }[] }): { name: string; selector: string; text: string } | null {
  const filled = row.columns.filter((c) => c.text !== "" && row.click !== c.selector && !row.click.startsWith(`${c.selector} `));
  return filled.find((c) => /번호|코드|아이디|\bid\b|\bno\b|code/i.test(c.name)) ?? filled[0] ?? null;
}

/** 출력 이름으로 쓸 수 있게 — 글자 · 숫자 · _ 만 */
export const toName = (s: string, fb: string): string => {
  const n = s.replace(/^'|'\s*\S*$/g, "").replace(/[^\p{L}\p{N}_]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return n || fb;
};
