/**
 * **검사** 노드 — 웹 e2e 테스트의 판정(PLAN §39). 앞 노드가 읽은 값이 기대대로인지 항목마다 본다.
 *
 *   항목  실제값(표현식) · 견주는 법 · 기대값(표현식, 단항이면 없음) · 이름
 *   판정  ★항목 하나가 틀려도 **나머지를 다 본다**(soft assertion) — 틀린 것을 한 번에 다 알린다
 *         하나라도 틀리면 노드가 «불통과»(problem check)로 실패한다 · 다 맞으면 받은 값을 그대로 넘긴다
 *
 * 견주는 법은 조건 노드와 같다(같다 · 포함 · 정규식 · 숫자 크기 · 비어 있음 …) + 목록용(행 수 · 이 값이 든 행).
 */
import { compareValues, CONDITION_OPS, UNARY_OPS, type ConditionOp } from "./condition.ts";
import { evaluate, type Scope } from "../expr.ts";

/** 목록(표 읽기 · 되풀이 목록)에 쓰는 것 — 행 수 · 어느 행이든 이 값 */
export const CHECK_LIST_OPS = ["countEq", "countGte", "countLte", "anyEq", "anyContains"] as const;
export const CHECK_OPS = [...CONDITION_OPS, ...CHECK_LIST_OPS] as const;
export type CheckOp = (typeof CHECK_OPS)[number];
export const CHECK_UNARY_OPS: readonly CheckOp[] = UNARY_OPS;

export const CHECK_OP_LABEL: Record<CheckOp, string> = {
  eq: "같다", ne: "다르다", contains: "포함한다", notContains: "포함하지 않는다", startsWith: "로 시작한다", endsWith: "로 끝난다", matches: "정규식에 맞는다",
  empty: "비어 있다", notEmpty: "비어 있지 않다", gt: "보다 크다", gte: "이상이다", lt: "보다 작다", lte: "이하이다", isTrue: "참이다", isFalse: "거짓이다",
  countEq: "행 수가 같다", countGte: "행 수가 이상이다", countLte: "행 수가 이하이다", anyEq: "이 값인 칸이 있다", anyContains: "이 글자가 든 칸이 있다",
};

export interface CheckItem {
  id: string;
  /** 사람이 부르는 이름 — «첫 금액» */
  label: string;
  /** 실제값 — 「{{ $input.firstAmount }}」 */
  actual: string;
  op: CheckOp;
  /** 기대값 — 표현식 또는 글자. 단항(비어 있음 · 참 …)이면 null */
  expected: string | null;
}

export interface CheckConfig {
  items: CheckItem[];
}

/** 항목 하나의 판정 — 실행 기록 · 테스트 결과에 그대로 남는다 */
export interface CheckResult {
  id: string;
  label: string;
  op: CheckOp;
  /** 보인 값(글자로 · 200자까지) */
  actual: string;
  expected: string | null;
  pass: boolean;
  /** 판정을 못 했다(숫자로 못 읽음 · 목록이 아님 · 정규식 틀림) — 불통과로 센다 */
  error: string | null;
}

/** 검사 노드가 넘기는 것 — 받은 값 + 맞은 수 · 틀린 수 */
export const CHECK_OUTPUTS = ["checksPassed", "checksFailed"] as const;

const shown = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 200 ? `${s.slice(0, 199)}…` : s;
};

const cells = (row: unknown): unknown[] => (row !== null && typeof row === "object" ? Object.values(row as Record<string, unknown>) : [row]);

function listTest(op: (typeof CHECK_LIST_OPS)[number], actual: unknown, expected: unknown, what: string): boolean {
  if (!Array.isArray(actual)) throw new Error(`${what}: 목록이 아닙니다(표 읽기 · 되풀이 목록의 값을 고르세요)`);
  switch (op) {
    case "countEq": return compareValues("eq", actual.length, expected, what);
    case "countGte": return compareValues("gte", actual.length, expected, what);
    case "countLte": return compareValues("lte", actual.length, expected, what);
    case "anyEq": return actual.some((r) => cells(r).some((c) => compareValues("eq", c, expected, what)));
    case "anyContains": return actual.some((r) => cells(r).some((c) => compareValues("contains", c, expected, what)));
  }
}

/** 다 본다 — 하나가 틀려도 멈추지 않는다. ★시크릿은 쓸 수 없다(결과에 그대로 남는다) */
export function runChecks(config: CheckConfig, scope: Scope): CheckResult[] {
  const noSecrets: Scope = { ...scope, secrets: {} };
  return config.items.map((it) => {
    const base = { id: it.id, label: it.label || it.id, op: it.op };
    let actual: unknown;
    let expected: unknown;
    try {
      actual = evaluate(it.actual, noSecrets).value;
      expected = it.expected === null ? undefined : evaluate(it.expected, noSecrets).value;
      const pass = (CHECK_LIST_OPS as readonly string[]).includes(it.op)
        ? listTest(it.op as (typeof CHECK_LIST_OPS)[number], actual, expected, base.label)
        : compareValues(it.op as ConditionOp, actual, expected, base.label);
      return { ...base, actual: shown(actual), expected: expected === undefined ? null : shown(expected), pass, error: null };
    } catch (e) {
      return { ...base, actual: shown(actual), expected: expected === undefined ? null : shown(expected), pass: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** 틀린 것들을 한 줄로 — «첫 금액: 기대 «400000 이상이다», 실제 «350,000원»» */
export function checkSummary(results: readonly CheckResult[]): string {
  const bad = results.filter((r) => !r.pass);
  const one = (r: CheckResult) => r.error ? `${r.label}: ${r.error}` : `${r.label}: 기대 «${r.expected === null ? "" : `${r.expected} `}${CHECK_OP_LABEL[r.op]}», 실제 «${r.actual}»`;
  return `검사 ${results.length}개 중 ${bad.length}개 불통과 — ${bad.slice(0, 3).map(one).join(" · ")}${bad.length > 3 ? ` 외 ${bad.length - 3}개` : ""}`;
}

/**
 * 테스트 판정 — 실행 결과를 통과 · 불통과 · 오류로 나눈다(Suite · 실행 기록).
 *   pass  끝까지 돌았다(성공 · 막힘 — 막힘도 사람이 정한 갈래로 끝났다)
 *   fail  검사 노드가 틀렸다(값이 기대와 다르다)
 *   error 테스트를 끝까지 못 돌렸다(사이트 · 요소 · 시간 · 멈춤)
 */
export type Verdict = "pass" | "fail" | "error";
export const VERDICT_LABEL: Record<Verdict, string> = { pass: "통과", fail: "불통과", error: "오류" };
export function verdictOf(status: string, failedProblem: string | null | undefined): Verdict {
  if (status === "success" || status === "blocked") return "pass";
  if (status === "failure" && failedProblem === "check") return "fail";
  return "error";
}
