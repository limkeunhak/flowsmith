/**
 * 값 다듬기 노드를 실행기로 — 앞 노드의 목록을 받아 다듬고 rows · count · first를 다음 노드로 · 거르기 값에 실행 입력 · 기록 (2026-10-16).
 */
import { describe, expect, it } from "vitest";
import { parseFlow } from "@flowsmith/core";
import { runFlow } from "../src/index.ts";

const pos = { x: 0, y: 0 };
const flow = (steps: unknown[]) => parseFlow({
  schemaVersion: 1, id: "tf", name: "다듬기",
  params: [{ name: "kw", label: "검색어", required: true }],
  nodes: [
    { id: "src", type: "custom", name: "뉴스", position: pos, outputs: [], config: { outputs: ["rows"], code: "return { rows: [{ 제목: ' 오늘 날씨 ', 조회: '1,200회' }, { 제목: '주식', 조회: '30회' }, { 제목: '오늘 날씨', 조회: '5회' }] };" } },
    { id: "tf", type: "transform", name: "다듬기", position: pos, config: { source: "{{ $input.rows }}", steps } },
    { id: "use", type: "custom", name: "쓰기", position: pos, config: { outputs: ["seen"], code: "return { seen: `${input.count}:${input.first?.title ?? '-'}` };" } },
  ],
  edges: [{ id: "e1", from: { node: "src", port: "out" }, to: { node: "tf" } }, { id: "e2", from: { node: "tf", port: "out" }, to: { node: "use" } }],
});

describe("값 다듬기 노드", () => {
  it("★다듬은 목록 · 행 수 · 첫 행을 다음 노드로 — 거르기 값은 실행 입력에서", async () => {
    const r = await runFlow(flow([
      { kind: "format", field: "제목", as: "trim" },
      { kind: "format", field: "조회", as: "number" },
      { kind: "filter", rules: [{ field: "제목", op: "contains", value: "{{ $params.kw }}" }] },
      { kind: "dedupe", fields: ["제목"] },
      { kind: "pick", fields: [{ from: "제목", to: "title" }, { from: "조회", to: "views" }] },
    ]), { params: { kw: "날씨" } });
    expect(r.status, r.message).toBe("success");
    const tf = r.nodes.find((n) => n.id === "tf")!;
    expect(tf.output).toEqual({ rows: [{ title: "오늘 날씨", views: 1200 }], count: 1, first: { title: "오늘 날씨", views: 1200 } });
    expect(tf.logs).toEqual(["3. 거르기 — 맞는 행만: 3 → 2행", "4. 겹치는 행 빼기: 1행 뺌", "1행을 내보냅니다"]);
    expect(r.nodes.find((n) => n.id === "use")!.output).toEqual({ seen: "1:오늘 날씨" });
  });

  it("못 견주면 노드가 멈추고 까닭을 사람 말로", async () => {
    const r = await runFlow(flow([{ kind: "filter", rules: [{ field: "제목", op: "gt", value: "3" }] }]), { params: { kw: "x" } });
    expect(r.status).toBe("failure");
    expect(r.nodes.find((n) => n.id === "tf")!.failure?.message).toMatch(/1번째 행의 「제목」 값 " 오늘 날씨 "을\(를\) 숫자로 읽을 수 없어/);
  });
});

describe("단계 실행(stopAfter)", () => {
  it("★이 노드까지 돌리고 멈춘다 — 뒤 노드는 «대기» · 결과는 «여기까지 성공»", async () => {
    const r = await runFlow(flow([{ kind: "limit", count: 1 }]), { params: { kw: "x" }, stopAfter: "tf" });
    expect(r.status).toBe("success");
    expect(r.message).toBe("「다듬기」까지 돌렸습니다");
    expect(r.nodes.map((n) => [n.id, n.status])).toEqual([["src", "succeeded"], ["tf", "succeeded"], ["use", "pending"]]);
    expect(r.nodes.find((n) => n.id === "tf")!.output).toMatchObject({ count: 1 });
  });
  it("그 노드가 실패하면 실패", async () => {
    const r = await runFlow(flow([{ kind: "filter", rules: [{ field: "제목", op: "gt", value: "3" }] }]), { params: { kw: "x" }, stopAfter: "tf" });
    expect(r.status).toBe("failure");
  });
});
