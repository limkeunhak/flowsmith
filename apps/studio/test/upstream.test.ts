/**
 * 녹화 — 앞 단계에서 읽은 값(editor/record/upstream.ts): 보일 줄 · 녹화한 글자를 이을 곳.
 */
import { describe, expect, it } from "vitest";
import { linkOf, rowsOf } from "../src/editor/record/upstream.ts";
import { normalize } from "../src/model/index.ts";

const flow = normalize({
  schemaVersion: 1, id: "f", name: "f",
  params: [{ name: "itemNo", label: "품목번호", type: "text", required: true }],
  nodes: [
    { id: "r", type: "custom", name: "주문 읽기", position: { x: 0, y: 0 }, config: { code: "return {};", outputs: ["orderNo", "owner", "rows", "n"] } },
    { id: "w", type: "web", name: "주문 넣기", position: { x: 300, y: 0 }, config: { start: { kind: "url", url: "https://x" }, actions: [] } },
  ],
  edges: [{ id: "e1", from: { node: "r", port: "out" }, to: { node: "w" } }],
});

describe("앞 단계에서 읽은 값", () => {
  const rows = rowsOf(flow, "w", { orderNo: "A-1001", owner: "홍길동", rows: [{ a: 1 }, { a: 2 }], n: 1, item: "P-77" }, { itemNo: "P-77" });

  it("줄 — 앞 노드 이름 › 값 이름 · 목록은 넣을 수 없다 · 실행 입력도", () => {
    expect(rows.map((r) => [r.label, r.shown, r.text])).toEqual([
      ["주문 읽기 › orderNo", "A-1001", "A-1001"],
      ["주문 읽기 › owner", "홍길동", "홍길동"],
      ["주문 읽기 › rows", "목록 2개", null],
      ["주문 읽기 › n", "1", "1"],
      ["앞 단계 › item", "P-77", "P-77"],
      ["실행 입력 › 품목번호", "P-77", "P-77"],
    ]);
    expect(rows[0]!.insert).toBe("{{ $input.orderNo }}");
    expect(rows.at(-1)!.insert).toBe("{{ $params.itemNo }}");
  });

  it("★잇기 — 하나와만 같으면(앞뒤 빈칸 무시) · 두 글자 미만은 잇지 않는다 · 앞 단계 값이 실행 입력보다 먼저", () => {
    expect(linkOf(rows, " A-1001 ")).toMatchObject({ kind: "one", row: { insert: "{{ $input.orderNo }}" } });
    expect(linkOf(rows, "1")).toBeNull();
    expect(linkOf(rows, "없는값")).toBeNull();
    expect(linkOf(rows, "P-77")).toMatchObject({ kind: "one", row: { insert: "{{ $input.item }}" } });
    const twins = rowsOf(flow, "w", { orderNo: "같음", owner: "같음" }, {});
    expect(linkOf(twins, "같음")).toMatchObject({ kind: "many" });
  });
});
