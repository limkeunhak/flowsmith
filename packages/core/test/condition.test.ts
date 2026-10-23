import { describe, expect, it } from "vitest";
import { ConditionError, decide, type ConditionConfig, type Scope } from "../src/index.ts";

const scope = (input: Record<string, unknown>): Scope => ({ input, nodes: {}, params: { limit: "10,000" }, vars: {}, secrets: { s: "x" } });
const cfg = (cases: ConditionConfig["cases"]): ConditionConfig => ({ cases, else: { then: { kind: "next" } } });
const one = (op: any, right: string | null, match: "all" | "any" = "all"): ConditionConfig =>
  cfg([{ id: "hit", label: "맞음", match, rules: [{ left: "{{ $input.v }}", op, right }], then: { kind: "next" } }]);
const port = (c: ConditionConfig, v: unknown) => decide(c, scope({ v })).port;

describe("조건 평가", () => {
  it("위에서부터 처음 맞는 갈래, 없으면 else", () => {
    const c = cfg([
      { id: "a", label: "a", match: "all", rules: [{ left: "{{ $input.v }}", op: "eq", right: "1" }], then: { kind: "next" } },
      { id: "b", label: "b", match: "all", rules: [{ left: "{{ $input.v }}", op: "notEmpty", right: null }], then: { kind: "next" } },
    ]);
    expect(port(c, "1")).toBe("a");
    expect(port(c, "2")).toBe("b");
    expect(port(c, "")).toBe("else");
  });

  it("글자 비교", () => {
    expect(port(one("eq", "배송중"), " 배송중 ")).toBe("hit");
    expect(port(one("contains", "취소"), "주문 취소됨")).toBe("hit");
    expect(port(one("startsWith", "A-"), "A-1001")).toBe("hit");
    expect(port(one("matches", "^\\d{3}-\\d{4}$"), "123-4567")).toBe("hit");
    expect(port(one("ne", "x"), "x")).toBe("else");
  });

  it("숫자 비교는 1,234원 같은 표기를 읽는다 — 오른쪽도 표현식", () => {
    expect(port(one("gt", "{{ $params.limit }}"), "12,500원")).toBe("hit");
    expect(port(one("lte", "100"), 100)).toBe("hit");
  });

  it("★숫자로 못 읽으면 다른 갈래로 새지 않고 던진다", () => {
    expect(() => port(one("gt", "100"), "없음")).toThrow(ConditionError);
  });

  it("비었나 — 없음 · 빈 글자 · 빈 배열", () => {
    expect(port(one("empty", null), undefined)).toBe("hit");
    expect(port(one("empty", null), "  ")).toBe("hit");
    expect(port(one("empty", null), [])).toBe("hit");
    expect(port(one("empty", null), [1])).toBe("else");
  });

  it("참/거짓", () => {
    expect(port(one("isTrue", null), "Y")).toBe("hit");
    expect(port(one("isTrue", null), true)).toBe("hit");
    expect(port(one("isFalse", null), "no")).toBe("hit");
    expect(port(one("isTrue", null), "아마")).toBe("else");
  });

  it("all은 하나라도 틀리면, any는 하나라도 맞으면", () => {
    const rules = [{ left: "{{ $input.v }}", op: "eq" as const, right: "1" }, { left: "{{ $input.v }}", op: "eq" as const, right: "2" }];
    expect(port(cfg([{ id: "hit", label: "", match: "all", rules, then: { kind: "next" } }]), "1")).toBe("else");
    expect(port(cfg([{ id: "hit", label: "", match: "any", rules, then: { kind: "next" } }]), "2")).toBe("hit");
  });

  it("판정 과정이 남는다", () => {
    const d = decide(one("eq", "1"), scope({ v: "1" }));
    expect(d.trace[0]!.rules[0]).toMatchObject({ left: "1", right: "1", result: true });
  });

  it("조건에서는 시크릿을 꺼낼 수 없다", () => {
    const c = cfg([{ id: "hit", label: "", match: "all", rules: [{ left: "{{ $secrets.s }}", op: "notEmpty", right: null }], then: { kind: "next" } }]);
    expect(() => decide(c, scope({}))).toThrow(/시크릿/);
  });
});
