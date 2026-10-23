/**
 * 실행 입력의 종류 — 글자 · 숫자 · 날짜 · 고르기 · 기본값 · 설명 (2026-10-18, Jenkins 매개변수처럼).
 */
import { describe, expect, it } from "vitest";
import { checkFlow, paramProblem, parseFlow, withParamDefaults } from "../src/index.ts";

const flowWith = (params: unknown[]) => ({
  schemaVersion: 1, id: "p", name: "입력", params,
  nodes: [{ id: "t", type: "custom", name: "t", position: { x: 0, y: 0 }, config: { code: "return {};", outputs: [] } }], edges: [],
});

describe("실행 입력의 종류", () => {
  it("값이 종류에 맞나 — 숫자(쉼표 허용) · 날짜(있는 날) · 고르기(보기 중 하나)", () => {
    expect(paramProblem({ type: "text", options: [] }, "아무거나")).toBeNull();
    expect(paramProblem({ type: "number", options: [] }, "1,234.5")).toBeNull();
    expect(paramProblem({ type: "number", options: [] }, "12개")).toMatch(/숫자가 아닙니다/);
    expect(paramProblem({ type: "date", options: [] }, "2026-10-18")).toBeNull();
    expect(paramProblem({ type: "date", options: [] }, "2026-02-30")).toMatch(/없는 날짜/);
    expect(paramProblem({ type: "date", options: [] }, "10/18")).toMatch(/2026-10-18처럼/);
    expect(paramProblem({ type: "select", options: ["현대", "기아"] }, "기아")).toBeNull();
    expect(paramProblem({ type: "select", options: ["현대", "기아"] }, "BMW")).toMatch(/보기\(현대 · 기아\)/);
  });

  it("옛 워크플로우(종류 없음)는 글자 · 보기 없음 · 기본값 없음으로 읽는다", () => {
    const f = parseFlow(flowWith([{ name: "orderNo", label: "주문번호", required: true }]));
    expect(f.params[0]).toEqual({ name: "orderNo", label: "주문번호", required: true, type: "text", options: [], default: "", help: "" });
  });

  it("검문소 — 고르기는 보기가 있어야 · 기본값도 종류에 맞아야 · 모르는 종류는 안 됨", () => {
    expect(checkFlow(flowWith([{ name: "maker", label: "제조사", type: "select", options: [] }])).join()).toMatch(/보기\(options\)가 하나 이상/);
    expect(checkFlow(flowWith([{ name: "d", label: "날짜", type: "date", default: "어제" }])).join()).toMatch(/기본값 — 날짜는/);
    expect(checkFlow(flowWith([{ name: "n", label: "수", type: "integer" }])).length).toBeGreaterThan(0);
    expect(checkFlow(flowWith([{ name: "maker", label: "제조사", type: "select", options: ["모나미", "동아"], default: "모나미", help: "연필 제조사" }]))).toEqual([]);
  });

  it("비어 있으면 기본값으로 — 넣은 값은 그대로", () => {
    const defs = parseFlow(flowWith([{ name: "a", label: "a", type: "text", default: "기본" }, { name: "b", label: "b", default: "" }])).params;
    expect(withParamDefaults(defs, {})).toEqual({ a: "기본" });
    expect(withParamDefaults(defs, { a: "  ", b: "x" })).toEqual({ a: "기본", b: "x" });
    expect(withParamDefaults(defs, { a: "넣음" })).toEqual({ a: "넣음" });
  });
});
