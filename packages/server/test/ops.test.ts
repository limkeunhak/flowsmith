/**
 * 운영 — 멈추기(API · 부른 실행까지) · 동시 실행 한도(차례 기다리기) · 기록 정리 (2026-10-16).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type App } from "../src/app.ts";
import { Housekeeper } from "../src/run/housekeeping.ts";
import { Store } from "../src/storage/store.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { InProcessWorker } from "../src/run/worker.ts";
import { caller as apiCaller, until } from "./helpers.ts";

const call = apiCaller(() => app.url);

let app: App;
let dir: string;

const pos = { x: 0, y: 0 };
/** 브라우저에서 ms 동안 기다리는 플로우 */
const slow = (id: string, ms: number) => ({
  schemaVersion: 1, id, name: id,
  nodes: [{ id: "w", type: "web", name: "기다리기", position: pos, config: { start: { kind: "url", url: "about:blank" }, actions: [{ id: "a1", kind: "wait", wait: { kind: "fixed", ms } }] } }],
  edges: [],
});
const caller = { schemaVersion: 1, id: "caller", name: "부르는 워크플로우",
  nodes: [{ id: "c", type: "flowCall", name: "부르기", position: pos, config: { flowId: "slow-child", version: "draft", items: "", params: {} } }], edges: [] };
const start = async (flowId: string) => (await call("POST", `/api/flows/${flowId}/runs`, { version: "draft" })).body.runId as string;
const runOf = async (runId: string) => (await call("GET", `/api/runs/${runId}`)).body;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-ops-"));
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), monitor: false, schedule: false, retention: false, maxConcurrentRuns: 1 });
  for (const f of [slow("slow", 20_000), slow("slow-child", 20_000), slow("quick", 300), caller]) await call("POST", "/api/flows", { draft: f });
});
afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("멈추기", () => {
  it("★API로 멈춘다 — «멈춤»으로 끝나고, 끝난 실행은 409", async () => {
    const id = await start("slow");
    await until(async () => (await runOf(id)).status === "running" && app.runs.isRunning("slow"));
    await new Promise((r) => setTimeout(r, 800));
    expect((await call("POST", `/api/runs/${id}/cancel`)).status).toBe(202);
    await app.runs.wait(id);
    expect(await runOf(id)).toMatchObject({ status: "cancelled", message: expect.stringMatching(/멈췄습니다/) });
    expect((await call("POST", `/api/runs/${id}/cancel`)).status).toBe(409);
  }, 30_000);

  it("★부른 실행(다른 워크플로우 실행)도 함께 멈춘다", async () => {
    const id = await start("caller");
    let child: any;
    await until(async () => {
      child = (await call("GET", "/api/flows/slow-child/runs")).body.find((r: any) => r.parentRunId === id);
      return child?.status === "running";
    });
    await new Promise((r) => setTimeout(r, 500));
    await call("POST", `/api/runs/${id}/cancel`);
    await app.runs.wait(id);
    expect((await runOf(id)).status).toBe("cancelled");
    await until(async () => (await runOf(child.id)).status !== "running");
    expect((await runOf(child.id)).status).toBe("cancelled");
  }, 30_000);
});

describe("동시 실행 한도", () => {
  it("★한도(1)를 넘으면 차례를 기다리고 — 앞이 끝나면 돈다 · 기다리다 멈출 수도 있다", async () => {
    const first = await start("quick");
    const second = await start("quick");
    const third = await start("quick");
    const events: string[] = [];
    const at: { firstDone?: number; secondStart?: number } = {};
    const offA = app.runs.subscribe(first, (e) => { if (e.kind === "node:end") at.firstDone = Date.now(); });
    const off = app.runs.subscribe(second, (e) => { events.push(e.kind); if (e.kind === "node:start") at.secondStart ??= Date.now(); });
    // 셋째는 기다리는 동안 멈춘다
    expect((await call("POST", `/api/runs/${third}/cancel`)).status).toBe(202);
    await app.runs.wait(first);
    await app.runs.wait(second);
    await app.runs.wait(third);
    off?.();
    offA?.();
    expect(events[0]).toBe("run:queued");
    expect((await runOf(first)).status).toBe("success");
    expect((await runOf(second)).status).toBe("success");
    expect(await runOf(third)).toMatchObject({ status: "cancelled", message: "실행을 멈췄습니다(차례를 기다리던 중)" });
    // 둘째는 첫째의 노드가 끝난 뒤에 시작했다(차례를 기다렸다)
    expect(at.secondStart).toBeGreaterThanOrEqual(at.firstDone!);
  }, 30_000);
});

describe("기록 정리", () => {
  it("★워크플로우마다 최근 n개 · n일 지난 것을 지운다 — 도는 실행은 둔다", () => {
    const store = new Store(":memory:");
    for (const id of ["a", "b"]) store.createFlow({ schemaVersion: 1, id, name: id, nodes: [], edges: [] });
    const t0 = Date.parse("2026-10-16T00:00:00Z");
    let n = 0;
    const add = (flowId: string, daysAgo: number, running = false) => {
      const id = `${flowId}-${n++}`;
      store.insertRun({ id, flowId, version: null, trigger: "manual", params: {}, startedAt: new Date(t0 - daysAgo * 86_400_000).toISOString() });
      if (!running) store.finishRun(id, "success", "", null, 1);
      return id;
    };
    const a = Array.from({ length: 6 }, (_, i) => add("a", i));        // 0~5일 전
    const aRunning = add("a", 200, true);                                // 200일 전에 시작해 아직 도는 실행
    const bOld = add("b", 120), bNew = add("b", 1);
    const out = new Housekeeper(store, { keepRuns: 3, keepDays: 90, keepProbes: 10 }).sweep(new Date(t0));
    expect(out.runs).toBe(4);                                             // a의 오래된 3개 + b의 120일 지난 1개
    const left = (flowId: string) => store.listRuns(flowId, 100).map((r) => r.id).sort();
    expect(left("a")).toEqual([...a.slice(0, 3), aRunning].sort());      // 최근 3개 + ★도는 실행
    expect(left("b")).toEqual([bNew]);
    void bOld;
    store.close();
  });
});

describe("단계 실행", () => {
  it("★초안을 이 노드까지만 — 없는 노드 · 게시된 버전은 받지 않는다", async () => {
    const bad = await call("POST", "/api/flows/quick/runs", { version: "draft", stopAfter: "없음" });
    expect(bad).toMatchObject({ status: 400, body: { error: '노드 "없음"가 없습니다' } });
    const { runId } = (await call("POST", "/api/flows/quick/runs", { version: "draft", stopBefore: "w" })).body;
    await app.runs.wait(runId);
    expect(await runOf(runId)).toMatchObject({ status: "success", message: "w 앞에서 멈췄습니다" });
  }, 30_000);
});

describe("워크플로우 목록", () => {
  it("쓰인 노드 종류 · 켜 둔 일정 · 마지막 실행 · 설명 첫 줄을 함께 준다", async () => {
    const list = (await call("GET", "/api/flows")).body as any[];
    const quick = list.find((f) => f.id === "quick");
    expect(quick).toMatchObject({ nodeTypes: ["web"], schedules: [], lastRun: { status: "success" }, description: expect.any(String) });
    expect(quick.description).not.toContain("\n");
    expect(list.find((f) => f.id === "caller").nodeTypes).toEqual(["flowCall"]);
  });
});
