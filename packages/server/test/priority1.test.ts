/**
 * 1순위(2026-10-18 — Jenkins · Airflow · n8n에서) — 서버 쪽:
 *   같은 입력으로 다시 실행 · 노드 출력 고정(초안 시험만) · 자원 잠금(같은 이름은 한 번에 하나) · 실행 입력의 종류 · 노드 시작 시각 · 캔버스 메모
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { InProcessWorker } from "../src/run/worker.ts";
import { caller, until } from "./helpers.ts";

const call = caller(() => app.url);
let app: App;
let dir: string;
const pos = { x: 0, y: 0 };

/** 계산 둘 — 앞(a)이 n을 내고 뒤(b)가 n+1 */
const calc = {
  schemaVersion: 1, id: "calc", name: "계산",
  params: [{ name: "n", label: "수", type: "number", default: "1" }, { name: "maker", label: "제조사", type: "select", options: ["현대", "기아"], required: false }],
  nodes: [
    { id: "a", type: "custom", name: "앞", position: pos, config: { code: "return { n: Number(ctx.params.n) };", outputs: ["n"] } },
    { id: "b", type: "custom", name: "뒤", position: pos, config: { code: "return { m: input.n + 1 };", outputs: ["m"] } },
  ],
  edges: [{ id: "e1", from: { node: "a", port: "out" }, to: { node: "b" } }],
  notes: [{ id: "m1", text: "앞은 입력을 숫자로, 뒤는 하나 더한다", position: { x: 10, y: 20 }, width: 300, height: 120, color: "blue" }],
};
/** 브라우저에서 ms 기다리는 플로우 — 자원 잠금 시험 */
const slow = (id: string, ms: number, locks: string[]) => ({
  schemaVersion: 1, id, name: id, settings: { locks },
  nodes: [{ id: "w", type: "web", name: "기다리기", position: pos, config: { start: { kind: "url", url: "about:blank" }, actions: [{ id: "a1", kind: "wait", wait: { kind: "fixed", ms } }] } }],
  edges: [],
});
const start = async (flowId: string, body: Record<string, unknown> = { version: "draft" }) => (await call("POST", `/api/flows/${flowId}/runs`, body)).body.runId as string;
const runOf = async (runId: string) => (await call("GET", `/api/runs/${runId}`)).body;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-p1-"));
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), monitor: false, schedule: false, retention: false, maxConcurrentRuns: 4 });
  const caller = { schemaVersion: 1, id: "caller-a", name: "부르는 워크플로우", settings: { locks: ["포털 계정A"] },
    nodes: [{ id: "c", type: "flowCall", name: "부르기", position: pos, config: { flowId: "acct-a2", version: "draft", items: "", params: {} } }], edges: [] };
  for (const f of [calc, slow("acct-a", 1500, ["포털 계정A"]), slow("acct-a2", 300, ["포털 계정A"]), slow("acct-b", 300, ["포털 계정B"]), caller]) {
    expect((await call("POST", "/api/flows", { draft: f })).status).toBe(201);
  }
}, 30_000);
afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("실행 입력의 종류", () => {
  it("★종류가 안 맞으면 400(돌지 않음) · 비면 기본값 — 실행 기록에 실제로 쓴 값이 남는다", async () => {
    const bad = await call("POST", "/api/flows/calc/runs", { version: "draft", params: { n: "열", maker: "BMW" } });
    expect(bad.status).toBe(400);
    expect(bad.body.problems.join()).toMatch(/숫자가 아닙니다.*보기\(현대 · 기아\)|보기\(현대 · 기아\).*숫자가 아닙니다/s);
    const id = await start("calc");
    await app.runs.wait(id);
    const r = await runOf(id);
    expect(r).toMatchObject({ status: "success", params: { n: "1" } });
    expect(r.result.output).toEqual({ m: 2 });
    // 노드 시작 시각(실행 시간표)
    expect(r.result.nodes.every((n: { startedAt: string | null }) => typeof n.startedAt === "string")).toBe(true);
  });
});

describe("같은 입력으로 다시 실행", () => {
  it("★입력 · 버전 그대로 새 실행 — 누가 했는지", async () => {
    await call("POST", "/api/flows/calc/versions", { note: "" });
    await call("POST", "/api/flows/calc/deploy", { version: 1 });
    const first = await start("calc", { params: { n: "41", maker: "기아" } });
    await app.runs.wait(first);
    const again = await call("POST", `/api/runs/${first}/rerun`);
    expect(again.status).toBe(202);
    expect(again.body.version).toBe(1);
    await app.runs.wait(again.body.runId);
    expect(await runOf(again.body.runId)).toMatchObject({ status: "success", version: 1, params: { n: "41", maker: "기아" }, trigger: "manual" });
    expect((await runOf(again.body.runId)).result.output).toEqual({ m: 42 });
    expect((await call("POST", "/api/runs/없는실행/rerun")).status).toBe(404);
  });
});

describe("노드 출력 고정", () => {
  it("★초안 시험에서 고정된 노드는 돌지 않고 그 값을 낸다 · 게시된 버전은 늘 진짜로 · 풀면 다시 돈다", async () => {
    const put = await call("PUT", "/api/flows/calc/pins/a", { output: { n: 100 } });
    expect(put.body.pins).toEqual({ a: { n: 100 } });
    expect((await call("GET", "/api/flows/calc")).body.pins).toEqual({ a: { n: 100 } });
    expect((await call("PUT", "/api/flows/calc/pins/a", { output: [1] })).status).toBe(400);

    const draft = await start("calc", { version: "draft", params: { n: "5" } });
    await app.runs.wait(draft);
    const d = await runOf(draft);
    expect(d.result.output).toEqual({ m: 101 });
    expect(d.result.nodes.find((n: { id: string }) => n.id === "a")).toMatchObject({ pinned: true, output: { n: 100 } });
    expect(d.result.nodes.find((n: { id: string }) => n.id === "a").logs.join()).toMatch(/고정된 출력/);

    const pub = await start("calc", { params: { n: "5" } });   // 게시된 버전
    await app.runs.wait(pub);
    expect((await runOf(pub)).result.output).toEqual({ m: 6 });

    // ★버전에는 들어가지 않는다 · 초안이 바뀐 것으로 치지 않는다
    expect(JSON.stringify((await call("GET", "/api/flows/calc/versions/1")).body)).not.toContain("pins");
    expect((await call("GET", "/api/flows/calc")).body.draftChanged).toBe(false);

    expect((await call("DELETE", "/api/flows/calc/pins/a")).body.pins).toEqual({});
    const after = await start("calc", { version: "draft", params: { n: "5" } });
    await app.runs.wait(after);
    expect((await runOf(after)).result.output).toEqual({ m: 6 });
  });
});

describe("자원 잠금", () => {
  it("★같은 자원은 한 번에 하나 — 뒤 실행은 누가 쓰는지 알리며 기다리다 앞이 끝나면 돈다 · 다른 자원은 같이 돈다", async () => {
    const first = await start("acct-a");
    await until(async () => (await runOf(first)).status === "running" && app.runs.lockState()["포털 계정A"]?.holder === first);
    const second = await start("acct-a2");
    const other = await start("acct-b");
    await app.runs.wait(other);
    expect((await runOf(other)).status).toBe("success");                 // 다른 자원 — 기다리지 않았다
    expect(app.runs.lockState()["포털 계정A"]).toMatchObject({ holder: first, waiting: 1 });
    const seen: unknown[] = [];
    const off = app.runs.subscribe(second, (e) => seen.push(e));
    expect(seen).toContainEqual({ kind: "run:locked", lock: "포털 계정A", holder: "acct-a" });
    off?.();
    await app.runs.wait(second);
    const [a, b] = [await runOf(first), await runOf(second)];
    expect(b.status).toBe("success");
    // 뒤 실행의 노드는 앞 실행이 끝난 뒤에 시작했다
    const firstEnd = Date.parse(a.startedAt) + a.ms;
    expect(Date.parse(b.result.nodes[0].startedAt)).toBeGreaterThanOrEqual(firstEnd - 50);
    expect(app.runs.lockState()).toEqual({});
  }, 30_000);

  it("기다리다 멈추면 «멈춤» — 자원은 다음 사람에게", async () => {
    const first = await start("acct-a");
    await until(() => app.runs.lockState()["포털 계정A"]?.holder === first);
    const second = await start("acct-a2");
    await until(() => app.runs.lockState()["포털 계정A"]?.waiting === 1);
    expect((await call("POST", `/api/runs/${second}/cancel`)).status).toBe(202);
    await app.runs.wait(second);
    expect(await runOf(second)).toMatchObject({ status: "cancelled", message: expect.stringMatching(/자원을 기다리던 중/) });
    await app.runs.wait(first);
    expect(app.runs.lockState()).toEqual({});
  }, 30_000);
});

describe("자원 잠금 — 부른 실행", () => {
  it("★부른 실행은 부모가 잡은 자원을 함께 쓴다 — 같은 자원을 다시 기다리다 막히지 않는다", async () => {
    const id = await start("caller-a");
    await app.runs.wait(id);
    expect((await runOf(id)).status).toBe("success");
    expect(app.runs.lockState()).toEqual({});
  }, 30_000);
});

describe("캔버스 메모", () => {
  it("초안 · 버전에 함께 남는다(실행과 상관없다)", async () => {
    const v = (await call("GET", "/api/flows/calc/versions/1")).body;
    expect(v.notes).toEqual([{ id: "m1", text: "앞은 입력을 숫자로, 뒤는 하나 더한다", position: { x: 10, y: 20 }, width: 300, height: 120, color: "blue" }]);
  });
});
