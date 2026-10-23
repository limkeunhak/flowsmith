/**
 * 검사(nodes/check.ts) — 항목마다 판정 · 다 본다 · 목록 견주기 · 검문소 · 판정(통과 · 불통과 · 오류).
 */
import { describe, expect, it } from "vitest";
import { checkSummary, parseFlow, runChecks, verdictOf, type CheckItem } from "../src/index.ts";

const scope = (input: Record<string, unknown>) => ({ input, nodes: {}, params: { min: "3" }, vars: {}, secrets: { pw: "secret-1" } });
const item = (op: CheckItem["op"], actual: string, expected: string | null, label: string = op): CheckItem => ({ id: op, label, actual, op, expected });

describe("검사", () => {
  it("★다 본다 — 틀린 것 · 판정 못 한 것도 남기고 다음으로", () => {
    const r = runChecks({ items: [
      item("gte", "{{ $input.price }}", "600000", "금액"),
      item("eq", "{{ $input.name }}", "홍길동", "이름"),
      item("gt", "{{ $input.name }}", "1", "숫자 아님"),
      item("countGte", "{{ $input.rows }}", "{{ $params.min }}", "행 수"),
      item("anyContains", "{{ $input.rows }}", "다라", "쇼핑몰"),
      item("notEmpty", "{{ $input.none }}", null, "없는 값"),
    ] }, scope({ price: "651,170원", name: "김철수", rows: [{ i: "가나상회" }, { i: "다라마트" }] }));
    expect(r.map((x) => [x.label, x.pass])).toEqual([["금액", true], ["이름", false], ["숫자 아님", false], ["행 수", false], ["쇼핑몰", true], ["없는 값", false]]);
    expect(r[1]).toMatchObject({ actual: "김철수", expected: "홍길동", error: null });
    expect(r[2]!.error).toMatch(/숫자로 읽을 수 없습니다/);
    expect(checkSummary(r)).toMatch(/^검사 6개 중 4개 불통과 — 이름: 기대 «홍길동 같다», 실제 «김철수» · 숫자 아님: .* 외 1개$/);
  });

  it("목록이 아닌 것에 목록 견주기 — 판정 못 함(불통과) · 시크릿은 못 읽는다", () => {
    const [r] = runChecks({ items: [item("countEq", "{{ $input.x }}", "1")] }, scope({ x: "글자" }));
    expect(r).toMatchObject({ pass: false, error: expect.stringMatching(/목록이 아닙니다/) });
    const [s] = runChecks({ items: [item("notEmpty", "{{ $secrets.pw }}", null)] }, scope({}));
    expect(s!.actual).not.toContain("secret-1");
  });

  it("검문소 — 실제값 · 기대값 · 단항 · 정규식 · 항목이 없으면", () => {
    const f = (items: unknown[]) => () => parseFlow({ schemaVersion: 1, id: "x", name: "x", nodes: [{ id: "k", type: "check", name: "검사", position: { x: 0, y: 0 }, config: { items } }], edges: [] });
    expect(f([{ id: "a", label: "금액", actual: "", op: "eq", expected: "1" }])).toThrow(/검사 1\(금액\): 무엇을 볼지\(실제값\)를 고르세요/);
    expect(f([{ id: "a", actual: "x", op: "eq", expected: null }])).toThrow(/기대값이 있어야/);
    expect(f([{ id: "a", actual: "x", op: "empty", expected: "1" }])).toThrow(/기대값을 쓰지 않습니다/);
    expect(f([{ id: "a", actual: "x", op: "matches", expected: "([" }])).toThrow();
    expect(f([])).toThrow(/검사 항목이 하나도 없습니다/);
  });

  it("판정 — 통과 · 불통과(검사) · 오류(그 밖)", () => {
    expect(verdictOf("success", null)).toBe("pass");
    expect(verdictOf("failure", "check")).toBe("fail");
    expect(verdictOf("failure", "timeout")).toBe("error");
  });
});
