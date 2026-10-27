/**
 * 워크플로우 목록 정돈(model/flowList.ts) — 화면 · Suite로 묶기 · 화면 규칙 제안 · 정렬 · 찾기 · 살펴볼 것.
 */
import { describe, expect, it } from "vitest";
import { areaNames, groupFlows, labelIn, matchesQuery, needsAttention, normPrefix, previewAreaCounts, redundantOverrides, sortFlows, splitName, suggestAreas, suiteKeys } from "../src/model/index.ts";
import type { FlowSummary } from "@flowsmith/server/api-types";

const flow = (id: string, name: string, more: Partial<FlowSummary> = {}): FlowSummary => ({
  id, name, description: "", activeVersion: 1, latestVersion: 1, problems: 0, updatedAt: "2026-10-27T00:00:00Z",
  monitor: null, nodeTypes: [], schedules: [], lastRun: null, team: null, runOn: null, group: null, area: null, site: null, ...more,
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
  it("★화면으로 — 직접 지정이 자동을 이긴다 · 이름 차례 · 화면 모름은 맨 뒤 · 이름이 «화면 · …»이면 앞말을 뗀다", () => {
    const g = groupFlows([
      flow("a", "Navigator · 검색", { area: "Navigator" }), flow("b", "주문 · 조회"), flow("c", "공지", { area: "qa.msu.io", group: "MSU 웹" }),
      flow("d", "Navigator · 랭킹", { area: "Navigator" }), flow("e", "Navigator · 다른 곳", { area: "MSU 웹" }),
    ]);
    expect(g.map((x) => x.name)).toEqual(["MSU 웹", "Navigator", null]);
    expect(g[0]!.flows.map((x) => x.label)).toEqual(["공지", "Navigator · 다른 곳"]);
    expect(g[1]!.flows.map((x) => x.label)).toEqual(["검색", "랭킹"]);    // 규칙에 없는 호스트는 뒤로
    expect(groupFlows([flow("a", "1", { area: "a.example" }), flow("b", "2", { area: "주문" })], undefined, (n) => n.includes(".")).map((x) => x.name)).toEqual(["주문", "a.example"]);
  });
  it("★Suite로 — 여러 Suite에 든 것은 여러 곳에 · 어디에도 없는 것은 null", () => {
    const keys = suiteKeys([{ name: "회귀", items: [{ flowId: "a" }, { flowId: "b" }, { flowId: "a" }] }, { name: "스모크", items: [{ flowId: "a" }] }]);
    const g = groupFlows([flow("a", "1"), flow("b", "2"), flow("c", "3")], keys);
    expect(g.map((x) => [x.name, x.flows.map((f) => f.flow.id)])).toEqual([["스모크", ["a"]], ["회귀", ["a", "b"]], [null, ["c"]]]);
  });
  it("묶음마다 살펴볼 것을 센다", () => {
    const g = groupFlows([flow("a", "1", { area: "N", problems: 2 }), flow("b", "2", { area: "N", lastRun: { status: "failure", at: "x" } }), flow("c", "3", { area: "N" })]);
    expect(g[0]!.attention).toBe(2);
  });
  it("labelIn — 다른 묶음의 앞말은 떼지 않는다", () => {
    expect(labelIn("주문", "주문 · 조회")).toBe("조회");
    expect(labelIn("결제", "주문 · 조회")).toBe("주문 · 조회");
    expect(labelIn(null, "주문 · 조회")).toBe("주문 · 조회");
  });
});

describe("화면 규칙 — 제안 · 미리 보기 · 직접 지정", () => {
  const fs = [
    flow("a", "1", { area: "qa.msu.io", site: "qa.msu.io/navigator" }), flow("b", "2", { area: "qa.msu.io", site: "qa.msu.io/navigator/nft/1" }),
    flow("c", "3", { area: "qa.msu.io", site: "qa.msu.io" }), flow("d", "4", { area: "qa.msu.io", site: "qa.msu.io" }),
    flow("e", "5", { area: "qa.msu.io", site: "qa.msu.io/swap" }), flow("f", "6", { area: "qa.msu.io", site: "qa.msu.io/navigator", group: "따로" }),
  ];
  it("★«호스트/첫 마디»로 둘 이상 — 많은 차례 · 이름은 첫 마디(첫 글자 크게) · 직접 지정한 것과 이미 규칙에 맞은 것은 빼고", () => {
    expect(suggestAreas(fs, [])).toEqual([{ prefix: "qa.msu.io", name: "qa.msu.io", count: 2 }, { prefix: "qa.msu.io/navigator", name: "Navigator", count: 2 }]);
    const ruled = fs.map((f) => (f.site?.startsWith("qa.msu.io/navigator") ? { ...f, area: "Navigator" } : f));
    expect(suggestAreas(ruled, [{ prefix: "qa.msu.io/navigator", name: "Navigator" }]).map((x) => x.prefix)).toEqual(["qa.msu.io"]);
  });
  it("미리 보기 — 가장 긴 앞부분이 이긴다 · 사람이 적은 꼴(https:// · 끝의 /)도 맞춘다", () => {
    expect(previewAreaCounts(fs, ["https://QA.msu.io/", "qa.msu.io/navigator", "틀린 꼴 이다"])).toEqual([3, 2, 0]);
    expect(normPrefix("https://QA.msu.io/navigator/?x=1")).toBe("qa.msu.io/navigator");
  });
  it("자동과 같은 직접 지정 · 메뉴의 이름들(규칙 + 쓰이는 것)", () => {
    expect(redundantOverrides([flow("a", "1", { area: "N", group: "N" }), flow("b", "2", { area: "N", group: "M" }), flow("c", "3", { area: "N" })])).toEqual(["a"]);
    expect(areaNames([flow("a", "1", { area: "나" }), flow("b", "2", { group: "가" }), flow("c", "3")], [{ name: "다" }])).toEqual(["가", "나", "다"]);
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
  it("찾기 — 이름 · id · 설명 · 화면, 띄어 쓴 낱말이 모두", () => {
    const f = flow("nav-search", "이름 검색", { description: "검색창에 캐릭터 이름을 넣으면 상세가 열린다", area: "Navigator" });
    expect(matchesQuery(f, "캐릭터 상세")).toBe(true);
    expect(matchesQuery(f, "nav-search")).toBe(true);
    expect(matchesQuery(f, "navigator 검색")).toBe(true);
    expect(matchesQuery(f, "캐릭터 지갑")).toBe(false);
  });
});
