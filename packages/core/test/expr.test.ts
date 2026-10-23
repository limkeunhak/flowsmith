import { describe, expect, it } from "vitest";
import { evaluate, ExprError, MASK, parseTemplate, redact, type Scope } from "../src/index.ts";

const scope = (over: Partial<Scope> = {}): Scope => ({
  input: { status: "배송중", amount: 12000, nested: { a: { b: "깊다" } } },
  nodes: { login: { userName: "홍길동" } },
  params: { orderNo: "A-1001" },
  vars: { baseUrl: "http://x" },
  secrets: { shop: { username: "kim", password: "p@ss" }, token: "tok-123" },
  ...over,
});

describe("표현식", () => {
  it("글자와 참조로 쪼갠다", () => {
    expect(parseTemplate("{{ $vars.baseUrl }}/orders/{{$params.orderNo}}").map((s) => s.kind)).toEqual(["ref", "text", "ref"]);
  });

  it("참조 하나뿐이면 값 그대로 — 숫자 · 객체 · 없음", () => {
    expect(evaluate("{{ $input.amount }}", scope()).value).toBe(12000);
    expect(evaluate("{{ $input.nested.a }}", scope()).value).toEqual({ b: "깊다" });
    expect(evaluate("{{ $input.missing }}", scope()).value).toBeUndefined();
  });

  it("글자 사이에 끼우면 문자열로 붙인다", () => {
    expect(evaluate("{{ $vars.baseUrl }}/o/{{ $params.orderNo }}?u={{ $node.login.userName }}", scope()).value)
      .toBe("http://x/o/A-1001?u=홍길동");
  });

  it("★글자 사이의 참조가 비어 있으면 던진다 — 빈 칸을 조용히 넣지 않는다", () => {
    expect(() => evaluate("주문 {{ $input.missing }}", scope())).toThrow(ExprError);
  });

  it("쓴 시크릿 값을 알려 준다", () => {
    const r = evaluate("{{ $secrets.shop.username }}:{{ $secrets.token }}", scope());
    expect(r.value).toBe("kim:tok-123");
    expect(r.secretsUsed).toEqual(["kim", "tok-123"]);
  });

  it("시크릿을 받으면 안 되는 자리(비운 scope)에서는 던진다", () => {
    expect(() => evaluate("{{ $secrets.token }}", scope({ secrets: {} }))).toThrow(/쓸 수 없거나/);
  });

  it("짝이 안 맞는 중괄호를 거부한다", () => {
    expect(() => parseTemplate("{{ $vars.baseUrl }")).toThrow(/짝이 안 맞는/);
    expect(() => parseTemplate("{{ }}")).toThrow(/비었습니다/);
  });

  it("마디 수를 지킨다", () => {
    expect(() => parseTemplate("{{ $node.login }}")).toThrow(/2개 이상/);
    expect(() => parseTemplate("{{ $params.a.b }}")).toThrow(/1 와야/);
    expect(() => parseTemplate("{{ $secrets.a.b.c }}")).toThrow(/1~2/);
  });

  it("한글 이름을 쓸 수 있다", () => {
    expect(evaluate("{{ $input.합계 }}", scope({ input: { 합계: 3 } })).value).toBe(3);
  });
});

describe("가리기", () => {
  it("문자열 안 · 객체 · 배열 끝까지 가린다", () => {
    const out = redact({ log: "login kim / p@ss", list: ["p@ss", 3], deep: { x: "token=p@ss" } }, ["p@ss", "kim"]);
    expect(out).toEqual({ log: `login ${MASK} / ${MASK}`, list: [MASK, 3], deep: { x: `token=${MASK}` } });
  });

  it("★긴 값부터 바꾼다 — 짧은 시크릿이 긴 시크릿의 일부여도 꼬리가 안 남는다", () => {
    expect(redact("abcdef", ["abc", "abcdef"])).toBe(MASK);
  });

  it("빈 시크릿은 무시한다 — 모든 글자 사이에 ***가 끼지 않게", () => {
    expect(redact("hello", [""])).toBe("hello");
  });
});
