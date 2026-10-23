/**
 * **값 다듬기 노드** — 코드 없이 목록을 다듬는다(PLAN §16). 순수하다 — 편집 화면이 같은 함수로 미리 보기를 그린다.
 *
 *   칸 고르기 · 이름 바꾸기 · 거르기 · 겹치는 행 빼기 · 값 바꾸기 표 · 형식(숫자만 · 공백 정리 · 날짜 · 글자 바꾸기) · 정렬 · 앞에서 n개
 *
 * 받는 것은 목록 — 「{{ $input.rows }}」. 객체 하나면 한 행짜리 목록으로, 글자 · 숫자 목록이면 행마다 { 값 }으로 본다.
 * 내놓는 것: rows(다듬은 목록) · count · first(첫 행 — 한 건만 다룰 때).
 * ★못 읽은 값(숫자 · 날짜)은 지어내지 않는다 — 숫자는 비우고, 날짜는 그대로 두고, 몇 개였는지 기록에 남긴다.
 */
import { compareValues, type ConditionOp } from "./condition.ts";

export interface PickField { from: string; to: string }
export interface FilterRule {
  field: string;
  op: ConditionOp;
  /** 비교할 값 — 표현식을 쓸 수 있다(실행 입력 · 변수). 단항 연산이면 null */
  value: string | null;
}
export interface MapEntry { from: string; to: string }

export const FORMAT_KINDS = ["number", "trim", "date", "replace"] as const;
export type FormatKind = (typeof FORMAT_KINDS)[number];

export type TransformStep =
  /** 이 칸들만, 이 순서로 — to가 비면 이름 그대로 */
  | { kind: "pick"; fields: PickField[] }
  | { kind: "filter"; match: "all" | "any"; rules: FilterRule[] }
  /** 이 칸들이 같으면 같은 행으로 — 비면 행 전체 */
  | { kind: "dedupe"; fields: string[] }
  /** 표에 있는 값은 바꾸고, 없는 값은 그대로 · 비움 · 정한 값 */
  | { kind: "map"; field: string; table: MapEntry[]; otherwise: "keep" | "empty" | "fixed"; fixed: string }
  | { kind: "format"; field: string; as: FormatKind; find: string; replace: string }
  | { kind: "sort"; field: string; order: "asc" | "desc" }
  | { kind: "limit"; count: number };

export const TRANSFORM_STEP_KINDS = ["pick", "filter", "dedupe", "map", "format", "sort", "limit"] as const;
export type TransformStepKind = (typeof TRANSFORM_STEP_KINDS)[number];

export const TRANSFORM_STEP_LABEL: Record<TransformStepKind, string> = {
  pick: "칸 고르기 · 이름 바꾸기", filter: "거르기 — 맞는 행만", dedupe: "겹치는 행 빼기", map: "값 바꾸기 표",
  format: "형식 다듬기", sort: "정렬", limit: "앞에서 몇 개만",
};

export const FORMAT_LABEL: Record<FormatKind, string> = {
  number: "숫자만 남기기(1,234원 → 1234)", trim: "공백 · 줄바꿈 정리", date: "날짜를 2026-10-16 모양으로(어제 · 3시간 전도)", replace: "글자 바꾸기",
};

export interface TransformConfig {
  /** 다듬을 목록 — 「{{ $input.rows }}」 */
  source: string;
  steps: TransformStep[];
}

export const TRANSFORM_OUTPUTS = ["rows", "count", "first"] as const;
/** 글자 · 숫자 목록을 행으로 볼 때의 칸 이름 */
export const VALUE_FIELD = "값";

export type Row = Record<string, unknown>;

export interface TransformResult {
  rows: Row[];
  /** 단계마다 — 「거르기: 12 → 5행」 · 「날짜: 2개는 날짜로 못 읽어 그대로 둠」 */
  notes: string[];
}

const text = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** 받은 값을 행 목록으로 */
export function toRows(v: unknown): Row[] {
  if (v === undefined || v === null) return [];
  const list = Array.isArray(v) ? v : [v];
  return list.map((x) => (x !== null && typeof x === "object" && !Array.isArray(x) ? { ...(x as Row) } : { [VALUE_FIELD]: x }));
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 날짜 글자 → YYYY-MM-DD. 못 읽으면 null */
export function parseDate(s: string, now: Date): string | null {
  const t = s.trim();
  if (t === "") return null;
  const ago = /^(\d+)\s*(초|분|시간|일|주)\s*전$/.exec(t);
  if (ago) {
    const n = Number(ago[1]);
    const ms = { 초: 1_000, 분: 60_000, 시간: 3_600_000, 일: 86_400_000, 주: 7 * 86_400_000 }[ago[2] as "초"];
    return ymd(new Date(now.getTime() - n * ms));
  }
  if (t === "오늘" || t === "방금" || t === "방금 전") return ymd(now);
  if (t === "어제") return ymd(new Date(now.getTime() - 86_400_000));
  if (t === "그제" || t === "그저께") return ymd(new Date(now.getTime() - 2 * 86_400_000));
  // 2026.10.16 · 2026-10-16 09:00 · 2026/10/16 · 2026년 10월 16일 · 2026.10.16.
  let m = /(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/.exec(t);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  // 20261016
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  // 10.16 · 10월 16일 — 올해
  m = /^(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?\.?$/.exec(t);
  if (m) return valid(now.getFullYear(), Number(m[1]), Number(m[2]));
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? ymd(dt) : null;
}

/** 숫자만 — 1,234원 · ₩1,234 · -12.5% → 숫자. 못 읽으면 null */
export function parseNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = text(v).replace(/[^0-9.+-]/g, "");
  if (s === "" || s === "-" || s === "+") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function sortKey(a: unknown, b: unknown): number {
  const na = parseNumber(a), nb = parseNumber(b);
  const numeric = na !== null && nb !== null && /^[\s\d.,+\-₩$%원]+$/.test(text(a)) && /^[\s\d.,+\-₩$%원]+$/.test(text(b));
  if (numeric) return na - nb;
  return text(a).localeCompare(text(b), "ko");
}

/**
 * 다듬는다. ★filter의 value는 이미 채운 값(표현식을 푼 값)이어야 한다 — 엔진이 채워서 준다.
 * 숫자 비교에서 숫자로 못 읽으면 던진다(조건 노드와 같다 — 조용히 빠지면 틀린 목록이 된다).
 */
export function applyTransform(input: unknown, steps: readonly TransformStep[], now = new Date()): TransformResult {
  let rows = toRows(input);
  const notes: string[] = [];
  for (const [i, s] of steps.entries()) {
    const before = rows.length;
    const at = `${i + 1}. ${TRANSFORM_STEP_LABEL[s.kind]}`;
    switch (s.kind) {
      case "pick":
        rows = rows.map((r) => Object.fromEntries(s.fields.map((f) => [f.to.trim() || f.from, r[f.from] ?? ""])));
        break;
      case "filter":
        rows = rows.filter((r, ri) => {
          const res = s.rules.map((rule) => {
            try { return compareValues(rule.op, r[rule.field], rule.value ?? undefined, rule.field); } catch (e) {
              // 사람 말로 — 어느 행의 어느 칸이 왜, 그리고 어떻게 하면 되는지
              if (e instanceof Error && /숫자로 읽을 수 없습니다/.test(e.message)) {
                throw new Error(`${at}: ${ri + 1}번째 행의 「${rule.field}」 값 ${JSON.stringify(text(r[rule.field]))}을(를) 숫자로 읽을 수 없어 견줄 수 없습니다 — 앞에 «형식 다듬기 › 숫자만 남기기»를 두거나 «비어 있지 않음»으로 먼저 거르세요`);
              }
              throw e;
            }
          });
          return s.match === "all" ? res.every(Boolean) : res.some(Boolean);
        });
        notes.push(`${at}: ${before} → ${rows.length}행`);
        break;
      case "dedupe": {
        const seen = new Set<string>();
        rows = rows.filter((r) => {
          const key = JSON.stringify(s.fields.length ? s.fields.map((f) => text(r[f])) : r);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        notes.push(`${at}: ${before - rows.length}행 뺌`);
        break;
      }
      case "map": {
        const table = new Map(s.table.map((e) => [e.from.trim(), e.to]));
        let missed = 0;
        rows = rows.map((r) => {
          const v = text(r[s.field]).trim();
          if (table.has(v)) return { ...r, [s.field]: table.get(v) };
          missed++;
          return s.otherwise === "keep" ? r : { ...r, [s.field]: s.otherwise === "empty" ? "" : s.fixed };
        });
        if (missed) notes.push(`${at}: 표에 없는 값 ${missed}개 — ${s.otherwise === "keep" ? "그대로 둠" : s.otherwise === "empty" ? "비움" : `「${s.fixed}」로`}`);
        break;
      }
      case "format": {
        let bad = 0;
        rows = rows.map((r) => {
          const v = r[s.field];
          switch (s.as) {
            case "number": { const n = parseNumber(v); if (n === null && text(v).trim() !== "") bad++; return { ...r, [s.field]: n }; }
            case "trim": return { ...r, [s.field]: text(v).replace(/\s+/g, " ").trim() };
            case "date": { const d = parseDate(text(v), now); if (d === null && text(v).trim() !== "") bad++; return { ...r, [s.field]: d ?? v }; }
            case "replace": return { ...r, [s.field]: s.find === "" ? text(v) : text(v).split(s.find).join(s.replace) };
          }
        });
        if (bad) notes.push(`${at}: ${bad}개는 ${s.as === "number" ? "숫자로 못 읽어 비움" : "날짜로 못 읽어 그대로 둠"}`);
        break;
      }
      case "sort":
        rows = [...rows].sort((a, b) => (s.order === "asc" ? 1 : -1) * sortKey(a[s.field], b[s.field]));
        break;
      case "limit":
        rows = rows.slice(0, s.count);
        if (before > rows.length) notes.push(`${at}: ${before} → ${rows.length}행`);
        break;
    }
  }
  return { rows, notes };
}

export function withTransformDefaults(c: Partial<TransformConfig> | undefined): TransformConfig {
  // 단계마다 빠진 칸은 그 단계의 기본값으로(초안은 검문소를 안 거친 채 저장된다)
  const steps = (c?.steps ?? []).map((s) => (TRANSFORM_STEP_KINDS.includes(s?.kind) ? { ...newStep(s.kind), ...s } as TransformStep : s));
  return { source: c?.source ?? "", steps };
}

export function newStep(kind: TransformStepKind): TransformStep {
  switch (kind) {
    case "pick": return { kind, fields: [] };
    case "filter": return { kind, match: "all", rules: [{ field: "", op: "contains", value: "" }] };
    case "dedupe": return { kind, fields: [] };
    case "map": return { kind, field: "", table: [{ from: "", to: "" }], otherwise: "keep", fixed: "" };
    case "format": return { kind, field: "", as: "trim", find: "", replace: "" };
    case "sort": return { kind, field: "", order: "asc" };
    case "limit": return { kind, count: 10 };
  }
}
