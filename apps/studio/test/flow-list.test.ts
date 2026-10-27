/**
 * 워크플로우 목록 정돈(model/flowList.ts) — 이름 앞말로 묶기 · 정렬 · 찾기 · 살펴볼 것.
 */
import { describe, expect, it } from "vitest";
import { groupFlows, groupNames, labelIn, matchesQuery, needsAttention, sortFlows, splitName, suggestGroups } from "../src/model/index.ts";
import type { FlowSummary } from "@flowsmith/server/api-types";

const flow = (id: string, name: string, more: Partial<FlowSummary> = {}): FlowSummary => ({
  id, name, description: "", activeVersion: 1, latestVersion: 1, problems: 0, updatedAt: "2026-10-27T00:00:00Z",
  monitor: null, nodeTypes: [], schedules: [], lastRun: null, team: null, runOn: null, group: null, ...more,
});

describe("splitName", () => {
  it("«묶음 · 나머지» — 첫 « · »에서만 자른다", () => {
    expect(splitName("Navigator · 이름 검색 → 상세")).toEqual({ group: "Navigator", rest: "이름 검색 → 상세" });
    expect(splitName("MSU 웹 · 공지 · 목록")).toEqual({ group: "MSU 웹", rest: "공지 · 목록" });
  });
  it("앞말이 없거나 너무 길면 묶음이 아니다", () => {
    expect(splitName("주문 상태 읽기")).toBeNull();
    expect(splitName(" · 앞이 빔")).toBeNull();
    expect(splitName("아주 긴 문장으로 시작하는 이름이라서 앞말이 아니다 · 끝")).toBeNull();
  });
});

describe("groupFlows", () => {
  it("★묶음은 이름표대로 · 이름 차례 · 묶음 없음은 맨 뒤 · 이름이 «묶음 · …»이면 앞말을 뗀다", () => {
    const g = groupFlows([
      flow("a", "Navigator · 검색", { group: "Navigator" }), flow("b", "주문 · 조회"), flow("c", "공지", { group: "MSU 웹" }),
      flow("d", "Navigator · 랭킹", { group: "Navigator" }), flow("e", "Navigator · 이름표 없음"),
    ]);
    expect(g.map((x) => x.name)).toEqual(["MSU 웹", "Navigator", null]);
    expect(g[1]!.flows.map((x) => x.label)).toEqual(["검색", "랭킹"]);
    // 이름표가 없으면 앞말이 같아도 묶지 않는다(제안만)
    expect(g[2]!.flows.map((x) => x.label)).toEqual(["주문 · 조회", "Navigator · 이름표 없음"]);
  });
  it("묶음마다 살펴볼 것을 센다", () => {
    const g = groupFlows([flow("a", "1", { group: "N", problems: 2 }), flow("b", "2", { group: "N", lastRun: { status: "failure", at: "x" } }), flow("c", "3", { group: "N" })]);
    expect(g[0]!.attention).toBe(2);
  });
  it("labelIn — 다른 묶음의 앞말은 떼지 않는다", () => {
    expect(labelIn("주문", "주문 · 조회")).toBe("조회");
    expect(labelIn("결제", "주문 · 조회")).toBe("주문 · 조회");
    expect(labelIn(null, "주문 · 조회")).toBe("주문 · 조회");
  });
});

describe("묶음 제안 · 이름들", () => {
  it("★묶음 없는 것 중 같은 앞말이 둘 이상 — 많은 차례 · 이미 묶인 것은 빼고", () => {
    const fs = [flow("a", "N · 1"), flow("b", "N · 2"), flow("c", "N · 3", { group: "N" }), flow("d", "M · 1"), flow("e", "M · 2"), flow("f", "M · 3"), flow("g", "혼자 · 1")];
    expect(suggestGroups(fs)).toEqual([{ group: "M", ids: ["d", "e", "f"] }, { group: "N", ids: ["a", "b"] }]);
  });
  it("있는 묶음 이름 — 겹치지 않게 · 이름 차례", () => {
    expect(groupNames([flow("a", "1", { group: "나" }), flow("b", "2", { group: "가" }), flow("c", "3", { group: "나" }), flow("d", "4")])).toEqual(["가", "나"]);
  });
});

describe("needsAttention · sortFlows · matchesQuery", () => {
  it("고칠 문제 · 실패 · 사이트 바뀜/깨짐", () => {
    expect(needsAttention(flow("a", "a"))).toBe(false);
    expect(needsAttention(flow("a", "a", { monitor: { status: "changed", at: "x", source: "probe" } }))).toBe(true);
    expect(needsAttention(flow("a", "a", { lastRun: { status: "success", at: "x" } }))).toBe(false);
  });
  it("정렬 — 이름은 숫자를 숫자로 · 최근 실행은 안 돌린 것이 뒤 · 살펴볼 것 먼저", () => {
    const fs = [flow("a", "단계 10", { updatedAt: "2026-10-27T03:00:00Z" }), flow("b", "단계 2", { lastRun: { status: "failure", at: "2026-10-27T01:00:00Z" } }), flow("c", "단계 1", { lastRun: { status: "success", at: "2026-10-27T02:00:00Z" } })];
    expect(sortFlows(fs, "name").map((f) => f.id)).toEqual(["c", "b", "a"]);
    expect(sortFlows(fs, "run").map((f) => f.id)).toEqual(["c", "b", "a"]);
    expect(sortFlows(fs, "attention")[0]!.id).toBe("b");
    expect(sortFlows(fs, "updated")[0]!.id).toBe("a");
  });
  it("찾기 — 이름 · id · 설명, 띄어 쓴 낱말이 모두", () => {
    const f = flow("nav-search", "Navigator · 이름 검색", { description: "검색창에 캐릭터 이름을 넣으면 상세가 열린다" });
    expect(matchesQuery(f, "캐릭터 상세")).toBe(true);
    expect(matchesQuery(f, "nav-search")).toBe(true);
    expect(matchesQuery(f, "캐릭터 지갑")).toBe(false);
  });
});
