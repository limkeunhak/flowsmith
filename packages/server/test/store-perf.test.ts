/**
 * 성능을 위해 바꾼 저장소가 같은 답을 주는가 — 한 번에 읽는 목록 · 노드 요약 · 옛 기록 · 버전 기억.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Store } from "../src/storage/store.ts";

const flow = (id: string, extra: Record<string, unknown> = {}) => ({ schemaVersion: 1, id, name: id, nodes: [], edges: [], ...extra });

describe("저장소", () => {
  it("★워크플로우 목록 — 마지막 실행 · 마지막 점검 · 문제 수(초안을 고치면 다시)", () => {
    const s = new Store(":memory:");
    s.createFlow(flow("a"));
    s.createFlow(flow("b"));
    const r1 = randomUUID(), r2 = randomUUID();
    s.insertRun({ id: r1, flowId: "a", version: null, trigger: "manual", params: {}, startedAt: "2026-10-17T01:00:00.000Z" });
    s.finishRun(r1, "failure", "깨짐", { nodes: [] }, 10);
    s.insertRun({ id: r2, flowId: "a", version: null, trigger: "manual", params: {}, startedAt: "2026-10-17T02:00:00.000Z" });
    s.finishRun(r2, "success", "", { nodes: [] }, 10);
    s.insertProbe({ id: randomUUID(), flowId: "a", version: null, source: "probe", status: "changed", report: null });
    const a = s.listFlows().find((f) => f.id === "a")!;
    expect(a.lastRun).toEqual({ status: "success", at: "2026-10-17T02:00:00.000Z" });
    expect(a.monitor).toMatchObject({ status: "changed", source: "probe" });
    expect(s.listFlows().find((f) => f.id === "b")).toMatchObject({ lastRun: null, monitor: null });
    expect(a.problems).toBe(1);   // 노드가 하나도 없습니다
    s.saveDraft("a", flow("a", { nodes: [{ id: "c", type: "custom", name: "c", position: { x: 0, y: 0 }, config: { code: "return {};", outputs: [] } }] }));
    expect(s.listFlows().find((f) => f.id === "a")!.problems).toBe(0);
    expect(s.flowNames()).toEqual(expect.arrayContaining([{ id: "a", name: "a" }, { id: "b", name: "b" }]));
  });

  it("★실행의 노드 요약 — 새 기록은 요약에서 · 옛 기록(요약 없음)은 결과에서", () => {
    const s = new Store(":memory:");
    s.createFlow(flow("a"));
    const id = randomUUID();
    s.insertRun({ id, flowId: "a", version: null, trigger: "manual", params: {}, startedAt: "2026-10-17T03:00:00.000Z" });
    s.finishRun(id, "failure", "깨짐", { nodes: [{ id: "w", name: "웹", type: "web", status: "failed", ms: 12, failure: { message: "못 찾음" }, steps: [{ big: "x".repeat(1000) }] }] }, 20);
    expect(s.runsSince("2026-10-17T00:00:00.000Z")[0]!.nodes).toEqual([{ id: "w", name: "웹", type: "web", status: "failed", ms: 12, failure: "못 찾음" }]);
  });

  it("팀 · 워커 — 하나 찾기 · 목록이 같은 답", () => {
    const s = new Store(":memory:");
    const t = s.createTeam("주문팀");
    const { worker } = s.createWorker({ name: "김담당 PC", team: t.id, labels: "홈쇼핑" });
    s.createFlow(flow("a"), t.id);
    s.setFlowRunOn("a", `worker:${worker.id}`);
    expect(s.getWorker(worker.id)).toEqual(s.listWorkers()[0]);
    expect(s.getWorker(worker.id)).toMatchObject({ team: { id: t.id, name: "주문팀" }, flows: 1, labels: ["홈쇼핑"] });
    expect(s.getTeam(t.id)).toEqual(s.listTeams()[0]);
    expect(s.getTeam(t.id)).toMatchObject({ flows: 1, members: [] });
    expect(s.findWorker("없음")).toBeNull();
  });

  it("버전 기억 — 내준 것을 고쳐도 다음 읽기는 그대로 · 지우고 다시 만든 워크플로우는 새 버전", () => {
    const s = new Store(":memory:");
    s.createFlow(flow("a", { nodes: [{ id: "c", type: "custom", name: "첫", position: { x: 0, y: 0 }, config: { code: "return {};", outputs: [] } }] }));
    s.createVersion("a", "");
    const v = s.getVersion("a", 1);
    v.nodes[0]!.name = "바꿈";
    expect(s.getVersion("a", 1).nodes[0]!.name).toBe("첫");
    s.deleteFlow("a");
    s.createFlow(flow("a", { nodes: [{ id: "c", type: "custom", name: "둘", position: { x: 0, y: 0 }, config: { code: "return {};", outputs: [] } }] }));
    s.createVersion("a", "");
    expect(s.getVersion("a", 1).nodes[0]!.name).toBe("둘");
  });
});
