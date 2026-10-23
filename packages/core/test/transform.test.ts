/**
 * 값 다듬기 — 칸 고르기 · 거르기 · 겹침 빼기 · 값 바꾸기 · 형식 · 정렬 · 앞 n개 · 검문소 (2026-10-16).
 */
import { describe, expect, it } from "vitest";
import { applyTransform, checkFlow, parseDate, parseNumber, toRows, type TransformStep } from "../src/index.ts";

const now = new Date(2026, 9, 16, 12, 0, 0);
const news = [
  { 제목: " 오늘 날씨\n맑음 ", 언론사: "가신문", 시각: "3시간 전", 조회: "1,234회" },
  { 제목: "내일 비", 언론사: "나일보", 시각: "어제", 조회: "56회" },
  { 제목: "오늘 날씨 맑음", 언론사: "가신문", 시각: "2026.10.14.", 조회: "—" },
  { 제목: "주식 시황", 언론사: "다경제", 시각: "10.13", 조회: "7,000회" },
];
const run = (steps: TransformStep[], input: unknown = news) => applyTransform(input, steps, now);

describe("단계마다", () => {
  it("★칸 고르기 · 이름 바꾸기 — 고른 칸만, 그 순서로", () => {
    const { rows } = run([{ kind: "pick", fields: [{ from: "언론사", to: "" }, { from: "제목", to: "title" }] }]);
    expect(rows[1]).toEqual({ 언론사: "나일보", title: "내일 비" });
    expect(Object.keys(rows[0]!)).toEqual(["언론사", "title"]);
  });

  it("★거르기 — 모두/하나라도 · 숫자는 1,234회도 숫자로 · 기록에 몇 행이 남았나", () => {
    const all = run([{ kind: "filter", match: "all", rules: [{ field: "제목", op: "contains", value: "날씨" }, { field: "언론사", op: "eq", value: "가신문" }] }]);
    expect(all.rows).toHaveLength(2);
    expect(all.notes).toEqual(["1. 거르기 — 맞는 행만: 4 → 2행"]);
    const any = run([{ kind: "filter", match: "any", rules: [{ field: "제목", op: "contains", value: "비" }, { field: "제목", op: "startsWith", value: "주식" }] }]);
    expect(any.rows.map((r) => r["언론사"])).toEqual(["나일보", "다경제"]);
    const big = run([{ kind: "filter", match: "all", rules: [{ field: "조회", op: "gte", value: "1000" }] }], news.filter((n) => n.조회 !== "—"));
    expect(big.rows.map((r) => r["조회"])).toEqual(["1,234회", "7,000회"]);
    // ★숫자로 못 읽으면 조용히 빼지 않고 멈춘다
    expect(() => run([{ kind: "filter", match: "all", rules: [{ field: "조회", op: "gte", value: "1000" }] }])).toThrow(/3번째 행의 「조회」 값 "—"을\(를\) 숫자로 읽을 수 없어 견줄 수 없습니다 — 앞에 «형식 다듬기/);
  });

  it("★형식 — 공백 정리 · 숫자만 · 날짜(어제 · 3시간 전 · 10.13) · 글자 바꾸기", () => {
    const { rows, notes } = run([
      { kind: "format", field: "제목", as: "trim", find: "", replace: "" },
      { kind: "format", field: "조회", as: "number", find: "", replace: "" },
      { kind: "format", field: "시각", as: "date", find: "", replace: "" },
      { kind: "format", field: "언론사", as: "replace", find: "신문", replace: "News" },
    ]);
    expect(rows.map((r) => r["제목"])).toEqual(["오늘 날씨 맑음", "내일 비", "오늘 날씨 맑음", "주식 시황"]);
    expect(rows.map((r) => r["조회"])).toEqual([1234, 56, null, 7000]);
    expect(rows.map((r) => r["시각"])).toEqual(["2026-10-16", "2026-10-15", "2026-10-14", "2026-10-13"]);
    expect(rows[0]!["언론사"]).toBe("가News");
    expect(notes).toEqual(["2. 형식 다듬기: 1개는 숫자로 못 읽어 비움"]);
  });

  it("★겹치는 행 빼기 — 고른 칸이 같으면(앞의 것을 남긴다) · 다듬은 뒤에 같아진 것도", () => {
    const r = run([{ kind: "format", field: "제목", as: "trim", find: "", replace: "" }, { kind: "dedupe", fields: ["제목"] }]);
    expect(r.rows.map((x) => x["시각"])).toEqual(["3시간 전", "어제", "10.13"]);
    expect(r.notes.at(-1)).toBe("2. 겹치는 행 빼기: 1행 뺌");
    expect(run([{ kind: "dedupe", fields: [] }], [{ a: 1 }, { a: 1 }, { a: 2 }]).rows).toHaveLength(2);
  });

  it("값 바꾸기 표 — 표에 없는 값은 그대로 · 비움 · 정한 값", () => {
    const table = [{ from: "가신문", to: "A" }, { from: "나일보", to: "B" }];
    expect(run([{ kind: "map", field: "언론사", table, otherwise: "keep", fixed: "" }]).rows.map((r) => r["언론사"])).toEqual(["A", "B", "A", "다경제"]);
    const fixed = run([{ kind: "map", field: "언론사", table, otherwise: "fixed", fixed: "기타" }]);
    expect(fixed.rows.at(-1)!["언론사"]).toBe("기타");
    expect(fixed.notes[0]).toMatch(/표에 없는 값 1개 — 「기타」로/);
  });

  it("정렬(숫자는 숫자로 · 글자는 가나다) · 앞에서 n개", () => {
    const nums = [{ n: "10" }, { n: "9" }, { n: "100" }];
    expect(run([{ kind: "sort", field: "n", order: "asc" }], nums).rows.map((r) => r["n"])).toEqual(["9", "10", "100"]);
    expect(run([{ kind: "sort", field: "언론사", order: "desc" }, { kind: "limit", count: 2 }]).rows.map((r) => r["언론사"])).toEqual(["다경제", "나일보"]);
  });

  it("받는 모양 — 객체 하나는 한 행 · 글자 목록은 { 값 } · 없으면 빈 목록", () => {
    expect(toRows({ a: 1 })).toEqual([{ a: 1 }]);
    expect(toRows(["가", "나"])).toEqual([{ 값: "가" }, { 값: "나" }]);
    expect(toRows(undefined)).toEqual([]);
  });

  it("날짜 · 숫자 읽기 — 못 읽으면 지어내지 않는다", () => {
    expect(parseDate("2026년 10월 3일", now)).toBe("2026-10-03");
    expect(parseDate("20261001", now)).toBe("2026-10-01");
    expect(parseDate("2026.02.30", now)).toBeNull();
    expect(parseDate("곧", now)).toBeNull();
    expect(parseNumber("₩ -12.5%")).toBe(-12.5);
    expect(parseNumber("없음")).toBeNull();
  });
});

describe("검문소", () => {
  const flow = (config: unknown) => ({
    schemaVersion: 1, id: "t", name: "t", params: [{ name: "kw", label: "검색어", required: false }],
    nodes: [
      { id: "src", type: "custom", name: "목록", position: { x: 0, y: 0 }, config: { code: "return { rows: [] }", outputs: ["rows"] } },
      { id: "tf", type: "transform", name: "다듬기", position: { x: 0, y: 0 }, config },
      { id: "after", type: "condition", name: "있나", position: { x: 0, y: 0 }, config: { cases: [{ id: "yes", label: "있음", match: "all", rules: [{ left: "{{ $input.count }}", op: "gt", right: "0" }], then: { kind: "end", status: "success", message: "" } }], else: { then: { kind: "end", status: "success", message: "" } } } },
    ],
    edges: [{ id: "e1", from: { node: "src", port: "out" }, to: { node: "tf" } }, { id: "e2", from: { node: "tf", port: "out" }, to: { node: "after" } }],
  });
  it("★맞는 설정은 통과 — 내보내는 rows · count · first를 뒤에서 쓸 수 있다 · 거르기 값에 실행 입력", () => {
    expect(checkFlow(flow({ source: "{{ $input.rows }}", steps: [{ kind: "filter", rules: [{ field: "제목", op: "contains", value: "{{ $params.kw }}" }] }, { kind: "limit", count: 5 }] }))).toEqual([]);
  });
  it("빠진 칸 · 모르는 단계 · 없는 참조는 들어오지 못한다", () => {
    // 모양 — 먼저 본다
    const shape = checkFlow(flow({ source: "{{ $input.rows }}", steps: [{ kind: "pick", fields: [] }, { kind: "sort", field: "" }, { kind: "explode" }] })).join("\n");
    expect(shape).toMatch(/남길 칸을 하나 이상/);
    expect(shape).toMatch(/어느 칸인지 고르세요/);
    expect(shape).toMatch(/모르는 값 "explode"/);
    // 참조 — 모양이 맞으면 본다
    const refs = checkFlow(flow({ source: "{{ $input.nope }}", steps: [{ kind: "filter", rules: [{ field: "a", op: "contains", value: "{{ $params.없음 }}" }] }] })).join("\n");
    expect(refs).toMatch(/"nope"를 내놓지 않습니다/);
    expect(refs).toMatch(/실행 입력 "없음"가 정의되지 않았습니다/);
  });
});
