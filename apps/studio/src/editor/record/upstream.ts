/**
 * **앞 단계에서 읽은 값** — 녹화할 때 앞 노드(재생)가 이 노드에 넘겨준 값과 실행 입력. 순수 함수(화면은 그리기만).
 *
 *   rowsOf     보일 줄들 — 이름(«조회 › orderNo») · 값 · 넣을 표현식(`{{ $input.orderNo }}`)
 *   linkOf     녹화한 입력의 글자가 이 값들 중 **하나와만** 같으면 그 줄 — 저절로 잇는다.
 *              ★두 글자 미만은 잇지 않는다(«1» · «Y»가 우연히 같아 엉뚱하게 이어지지 않게) · 여럿과 같으면 잇지 않고 알린다
 */
import type { Flow } from "@flowsmith/core";
import { suggestionsFor } from "../../model/index.ts";

export interface UpstreamRow {
  /** «조회 › orderNo» · «실행 입력 › 주문번호» */
  label: string;
  /** 넣을 표현식 */
  insert: string;
  /** 글자 하나로 넣을 수 있는 값이면 그 글자 — 목록 · 묶음은 null */
  text: string | null;
  /** 보일 값(목록이면 «목록 3개») */
  shown: string;
}

const scalar = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null);

export function rowsOf(flow: Flow, nodeId: string, input: Record<string, unknown> | null, params: Record<string, string>): UpstreamRow[] {
  const labels = new Map(suggestionsFor(flow, nodeId, false).map((s) => [s.insert, s.label]));
  const rows: UpstreamRow[] = [];
  for (const [k, v] of Object.entries(input ?? {})) {
    const insert = `{{ $input.${k} }}`;
    const text = scalar(v);
    rows.push({ label: labels.get(insert) ?? `앞 단계 › ${k}`, insert, text, shown: text ?? (Array.isArray(v) ? `목록 ${v.length}개` : JSON.stringify(v).slice(0, 80)) });
  }
  for (const p of flow.params) {
    const v = params[p.name];
    if (v === undefined || v === "") continue;
    rows.push({ label: `실행 입력 › ${p.label || p.name}`, insert: `{{ $params.${p.name} }}`, text: v, shown: v });
  }
  return rows;
}

export type Link = { kind: "one"; row: UpstreamRow } | { kind: "many"; rows: UpstreamRow[] } | null;

/** 녹화한 글자를 이을 곳 — 하나와만 같을 때 one */
export function linkOf(rows: readonly UpstreamRow[], typed: string): Link {
  const t = typed.trim();
  if (t.length < 2) return null;
  const same = rows.filter((r) => r.text !== null && r.text.trim() === t);
  // 앞 단계 값이 실행 입력을 그대로 넘긴 것이면 같은 값이 둘 — 앞 단계 값을 고른다
  const fromInput = same.filter((r) => r.insert.startsWith("{{ $input."));
  const pick = fromInput.length > 0 ? fromInput : same;
  if (pick.length === 1) return { kind: "one", row: pick[0]! };
  if (pick.length > 1) return { kind: "many", rows: pick };
  return null;
}
