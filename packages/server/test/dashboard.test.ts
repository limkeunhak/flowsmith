/**
 * 대시보드(run/stats.ts · /api/dashboard) — 실패율은 끝난 것으로 · P95 · 날마다 · 노드 종류 · 오류는 그 노드 · 보이는 플로우만.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dashboard, percentile, type StatRun } from "../src/run/stats.ts";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { InProcessWorker } from "../src/run/worker.ts";

const now = new Date("2026-10-17T15:00:00");
const ago = (days: number, h = 10) => { const d = new Date(now); d.setDate(d.getDate() - days); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const run = (p: Partial<StatRun> & { flowId: string; status: StatRun["status"] }): StatRun => ({
  id: randomUUID(), trigger: "schedule", startedAt: ago(0), ms: 1000, ranOn: null, parentRunId: null, message: "", version: 1, startedBy: null, nodes: [], ...p,
});
const node = (type: string, status: string, ms = 100, failure: string | null = null) => ({ id: type, name: `${type} 노드`, type, status, ms, failure });

describe("집계", () => {
  it("★실패율은 끝난 실행(성공 + 실패)으로 — 멈춤 · 도는 중은 빼고 · P95 · 평균", () => {
    const runs = [
      run({ flowId: "a", status: "success", ms: 100 }), run({ flowId: "a", status: "success", ms: 200 }),
      run({ flowId: "a", status: "failure", ms: 900 }), run({ flowId: "a", status: "cancelled", ms: 50 }),
      run({ flowId: "a", status: "running", ms: null }),
    ];
    const d = dashboard(runs, new Map([["a", "에이"]]), 7, now);
    expect(d.totals).toMatchObject({ runs: 5, success: 2, failure: 1, cancelled: 1, running: 1, errorRate: 1 / 3, p95Ms: 900, avgMs: 313 });
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([], 95)).toBeNull();
  });

  it("★날마다는 빈 날도 0 · 기간 밖은 뺀다 · 노드 종류마다 · 돌지 않은 노드는 세지 않는다", () => {
    const runs = [
      run({ flowId: "a", status: "success", startedAt: ago(0), nodes: [node("web", "succeeded", 300), node("fileWrite", "succeeded", 10)] }),
      run({ flowId: "a", status: "failure", startedAt: ago(2), nodes: [node("web", "failed", 500, "'조회' 버튼을 찾지 못했습니다"), node("fileWrite", "pending")] }),
      run({ flowId: "a", status: "success", startedAt: ago(9) }),   // 7일 밖
    ];
    const d = dashboard(runs, new Map([["a", "에이"]]), 7, now);
    expect(d.byDay).toHaveLength(7);
    expect(d.byDay.map((x) => x.success + x.failure)).toEqual([0, 0, 0, 0, 1, 0, 1]);
    expect(d.totals.runs).toBe(2);
    expect(d.nodes).toMatchObject({ runs: 3, failed: 1 });
    expect(d.nodes.byType[0]).toMatchObject({ type: "web", count: 2, failed: 1, p95Ms: 500 });
    expect(d.errors[0]).toMatchObject({ flowName: "에이", node: "web 노드", nodeType: "web", message: "'조회' 버튼을 찾지 못했습니다" });
  });

  it("워크플로우마다 · 실행 위치 · 보이지 않는 워크플로우는 뺀다", () => {
    const runs = [
      run({ flowId: "a", status: "success" }), run({ flowId: "a", status: "failure", ranOn: "김담당 PC" }),
      run({ flowId: "b", status: "success" }), run({ flowId: "hidden", status: "failure" }),
    ];
    const d = dashboard(runs, new Map([["a", "에이"], ["b", "비"]]), 1, now);
    expect(d.totals.runs).toBe(3);
    expect(d.byFlow.map((f) => [f.name, f.runs, f.errorRate])).toEqual([["에이", 2, 0.5], ["비", 1, 0]]);
    expect(d.byPlace).toEqual([{ place: null, count: 2 }, { place: "김담당 PC", count: 1 }]);
    expect(d.recent.some((r) => r.flowId === "hidden")).toBe(false);
  });
});

describe("/api/dashboard", () => {
  let app: App;
  let dir: string;
  const cookie: Record<string, string> = {};
  const call = async (path: string, who?: string) => {
    const r = await fetch(app.url + path, { headers: who ? { cookie: cookie[who]! } : {} });
    return { status: r.status, body: await r.json() as any };
  };
  const post = async (path: string, body: unknown, who?: string) => {
    const r = await fetch(app.url + path, { method: "POST", headers: { "content-type": "application/json", ...(who ? { cookie: cookie[who]! } : {}) }, body: JSON.stringify(body) });
    return { body: await r.json() as any, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? null };
  };
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "flowsmith-dash-"));
    app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), monitor: false, schedule: false, retention: false, auth: { enabled: true } });
    cookie["admin"] = (await post("/api/auth/setup", { token: app.auth.setupToken, email: "boss@x.com", name: "대표", password: "longpassword1" })).cookie!;
    const team = (await post("/api/teams", { name: "영업팀" }, "admin")).body.id;
    const u = (await post("/api/users", { email: "see@x.com", name: "보기", role: "viewer" }, "admin")).body;
    cookie["see"] = (await post("/api/auth/login", { email: "see@x.com", password: u.tempPassword })).cookie!;
    const flow = (id: string) => ({ schemaVersion: 1, id, name: id, nodes: [], edges: [] });
    await post("/api/flows", { draft: flow("pub") }, "admin");
    await post("/api/flows", { draft: flow("sales"), team }, "admin");
    for (const [flowId, status] of [["pub", "success"], ["pub", "failure"], ["sales", "failure"]] as const) {
      const id = randomUUID();
      app.store.insertRun({ id, flowId, version: 1, trigger: "manual", params: {} });
      app.store.finishRun(id, status, status === "failure" ? "깨짐" : "", { nodes: [{ id: "w", name: "웹", type: "web", status: status === "failure" ? "failed" : "succeeded", ms: 10, failure: status === "failure" ? { message: "깨짐" } : null }] }, 100);
    }
  });
  afterAll(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  it("★관리자는 전부 · 남의 팀 실행은 숫자에도 들지 않는다 · 워크플로우 하나만 · 기간 검사", async () => {
    expect((await call("/api/dashboard?days=7", "admin")).body.totals).toMatchObject({ runs: 3, failure: 2 });
    const seen = (await call("/api/dashboard?days=7", "see")).body;
    expect(seen.totals).toMatchObject({ runs: 2, failure: 1 });
    expect(seen.flows.map((f: { id: string }) => f.id)).toEqual(["pub"]);
    expect((await call("/api/dashboard?days=7&flow=sales", "see")).status).toBe(404);
    expect((await call("/api/dashboard?days=7&flow=pub", "admin")).body.totals.runs).toBe(2);
    expect((await call("/api/dashboard?days=0", "admin")).status).toBe(400);
    expect((await call("/api/dashboard?days=7")).status).toBe(401);
  });
});
