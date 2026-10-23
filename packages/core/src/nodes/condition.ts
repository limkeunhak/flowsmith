/**
 * 조건 노드 평가 — 순수하다 (PLAN §3.5).
 *
 * 위에서부터 처음 맞는 갈래를 고르고, 아무것도 안 맞으면 `else`.
 * ★숫자 비교에서 숫자로 못 읽으면 «아니다»가 아니라 **던진다** — 조용히 다른 갈래로 새면
 *  그게 «비어 있지 않은데 틀린 값»이다.
 */
import { ELSE_PORT } from "../flow.ts";
import { evaluate, type Scope } from "../expr.ts";

export const CONDITION_OPS = [
  "eq", "ne", "contains", "notContains", "startsWith", "endsWith", "matches",
  "empty", "notEmpty", "gt", "gte", "lt", "lte", "isTrue", "isFalse",
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

/** 오른쪽 값이 필요 없는 연산 */
export const UNARY_OPS: readonly ConditionOp[] = ["empty", "notEmpty", "isTrue", "isFalse"];

export interface Rule {
  /** 표현식 — "{{ $input.status }}" */
  left: string;
  op: ConditionOp;
  /** 표현식 또는 리터럴. 단항 연산이면 null */
  right: string | null;
}

export type Then =
  | { kind: "next" }
  | { kind: "end"; status: "success" | "failure"; message: string };

export interface ConditionCase {
  /** 출력 포트 이름이 된다 */
  id: string;
  label: string;
  match: "all" | "any";
  rules: Rule[];
  then: Then;
}

export interface ConditionConfig {
  cases: ConditionCase[];
  else: { then: Then };
}

export class ConditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConditionError";
  }
}

export interface Decision {
  /** 고른 출력 포트 — 갈래 id 또는 `else` */
  port: string;
  label: string;
  then: Then;
  /** 갈래마다 규칙이 어떻게 판정됐나 — 실행 기록에 남긴다 */
  trace: { case: string; rules: { rule: Rule; left: unknown; right: unknown; result: boolean }[]; matched: boolean }[];
}

const TRUE_WORDS = new Set(["true", "y", "yes", "1", "on"]);
const FALSE_WORDS = new Set(["false", "n", "no", "0", "off"]);

const asText = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).trim();

function asNumber(v: unknown, side: string, rule: Rule): number {
  if (typeof v === "number") return v;
  // 1,234원 · ₩ 1,234 · -12.5% — 숫자 · 소수점 · 부호만 남긴다
  const s = asText(v).replace(/[^0-9.+-]/g, "");
  const n = s === "" ? NaN : Number(s);
  if (!Number.isFinite(n)) throw new ConditionError(`${side} 값 ${JSON.stringify(v)}를 숫자로 읽을 수 없습니다 — "${rule.left} ${rule.op} ${rule.right ?? ""}"`);
  return n;
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return asText(v) === "";
}

function test(op: ConditionOp, l: unknown, r: unknown, rule: Rule): boolean {
  switch (op) {
    case "eq": return asText(l) === asText(r);
    case "ne": return asText(l) !== asText(r);
    case "contains": return asText(l).includes(asText(r));
    case "notContains": return !asText(l).includes(asText(r));
    case "startsWith": return asText(l).startsWith(asText(r));
    case "endsWith": return asText(l).endsWith(asText(r));
    case "matches": {
      let re: RegExp;
      try { re = new RegExp(asText(r), "u"); } catch (e) { throw new ConditionError(`정규식이 틀렸습니다: ${asText(r)} — ${(e as Error).message}`); }
      return re.test(asText(l));
    }
    case "empty": return isEmpty(l);
    case "notEmpty": return !isEmpty(l);
    case "gt": return asNumber(l, "왼쪽", rule) > asNumber(r, "오른쪽", rule);
    case "gte": return asNumber(l, "왼쪽", rule) >= asNumber(r, "오른쪽", rule);
    case "lt": return asNumber(l, "왼쪽", rule) < asNumber(r, "오른쪽", rule);
    case "lte": return asNumber(l, "왼쪽", rule) <= asNumber(r, "오른쪽", rule);
    case "isTrue": return l === true || TRUE_WORDS.has(asText(l).toLowerCase());
    case "isFalse": return l === false || FALSE_WORDS.has(asText(l).toLowerCase());
  }
}

/** 값 둘을 견준다 — 값 다듬기의 «거르기»가 쓴다(규칙과 같은 판정). `what`은 오류 메시지에 들어간다 */
export function compareValues(op: ConditionOp, left: unknown, right: unknown, what: string): boolean {
  return test(op, left, right, { left: what, op, right: right === undefined ? null : asText(right) });
}

/** 규칙 하나 — 동작의 «조건이 맞을 때만»이 쓴다. 시크릿은 쓸 수 없다 */
export function checkRule(rule: Rule, scope: Scope): { left: unknown; right: unknown; result: boolean } {
  const noSecrets: Scope = { ...scope, secrets: {} };
  const left = evaluate(rule.left, noSecrets).value;
  const right = rule.right === null ? undefined : evaluate(rule.right, noSecrets).value;
  return { left, right, result: test(rule.op, left, right, rule) };
}

/** 갈래를 고른다. 시크릿은 조건에서 못 쓰므로 scope.secrets는 비워서 준다 */
export function decide(config: ConditionConfig, scope: Scope): Decision {
  const noSecrets: Scope = { ...scope, secrets: {} };
  const trace: Decision["trace"] = [];
  for (const c of config.cases) {
    const rules = [];
    let matched = c.match === "all";
    for (const rule of c.rules) {
      const left = evaluate(rule.left, noSecrets).value;
      const right = rule.right === null ? undefined : evaluate(rule.right, noSecrets).value;
      const result = test(rule.op, left, right, rule);
      rules.push({ rule, left, right, result });
      if (c.match === "all" && !result) { matched = false; break; }
      if (c.match === "any" && result) { matched = true; break; }
    }
    trace.push({ case: c.id, rules, matched });
    if (matched) return { port: c.id, label: c.label, then: c.then, trace };
  }
  return { port: ELSE_PORT, label: "그 밖", then: config.else.then, trace };
}
