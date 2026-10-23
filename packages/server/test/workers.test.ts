/**
 * 워커(master/worker — PLAN §26) — 사람 PC의 워커가 서버에 붙어 일을 받아 간다.
 * 같은 프로세스 안에서 WorkerAgent(워커 프로그램의 속)를 서버에 붙여 본다.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { InProcessWorker, WorkerAgent } from "@flowsmith/worker";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { caller, until } from "./helpers.ts";

const call = caller(() => app.url);

let app: App;
let dir: string;
const agents: WorkerAgent[] = [];
const pos = { x: 0, y: 0 };

const newWorker = async (name: string, more: Record<string, unknown> = {}) => (await call("POST", "/api/workers", { name, ...more })).body as { worker: { id: string }; token: string };
const agentFor = async (token: string) => {
  const a = new WorkerAgent({ server: app.url, token, worker: new InProcessWorker(), reconnect: false, log: () => undefined });
  agents.push(a);
  await a.start();
  return a;
};
const runOf = async (flowId: string, extra: Record<string, unknown> = {}) => {
  const r = await call("POST", `/api/flows/${flowId}/runs`, { version: "draft", ...extra });
  expect(r.status).toBe(202);
  await app.runs.wait(r.body.runId);
  return (await call("GET", `/api/runs/${r.body.runId}`)).body;
};
const custom = (id: string, code: string) => ({ schemaVersion: 1, id, name: id, nodes: [{ id: "c", type: "custom", name: "c", position: pos, config: { code, outputs: ["n"] } }], edges: [] });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-workers-"));
  const filesDir = join(dir, "files");
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker({ filesDir }), filesDir, monitor: false, schedule: false, retention: false });
});
afterAll(async () => {
  for (const a of agents) await a.close();
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("붙기", () => {
  it("★토큰이 맞아야 붙는다 — 붙으면 워커 화면에 «연결됨» · 그 PC", async () => {
    const bad = new WorkerAgent({ server: app.url, token: "fsw_wrong", worker: new InProcessWorker(), reconnect: false, log: () => undefined });
    await expect(bad.start()).rejects.toThrow(/토큰이 맞지 않습니다/);
    expect(bad.state).toBe("denied");
    const { worker, token } = await newWorker("담당 PC", { labels: "홈쇼핑, 크롬" });
    expect(token).toMatch(/^fsw_/);
    const a = await agentFor(token);
    expect(a.state).toBe("online");
    expect(a.name).toBe("담당 PC");
    const list = (await call("GET", "/api/workers")).body;
    const w = list.workers.find((x: any) => x.id === worker.id);
    expect(w).toMatchObject({ online: true, labels: ["홈쇼핑", "크롬"], slots: 1, enabled: true });
    expect(w.info.host).toBeTruthy();
    expect(w).not.toHaveProperty("token");
    expect(list.labels).toEqual(["크롬", "홈쇼핑"]);
    expect(list.server).toMatchObject({ max: 3 });
  });
});

describe("WebSocket 길", () => {
  it("모르는 길은 404로 끊는다 — 받는 곳이 서로의 길을 알 필요가 없다", async () => {
    const code = await new Promise<number>((ok) => {
      const ws = new WebSocket(app.url.replace("http", "ws") + "/api/없는길");
      ws.on("unexpected-response", (_q, r) => ok(r.statusCode ?? 0));
      ws.on("error", () => ok(-1));
    });
    expect(code).toBe(404);
  });
});

describe("워커에서 돈다", () => {
  let wid: string;
  beforeAll(async () => {
    const { worker, token } = await newWorker("파일 PC", { labels: ["엑셀"] });
    wid = worker.id;
    await agentFor(token);
  });

  it("★워크플로우 설정대로 그 워커에서 — 파일은 서버에 남는다 · 기록에 «어디서»", async () => {
    await call("POST", "/api/flows", { draft: { schemaVersion: 1, id: "w-file", name: "파일 쓰고 읽기", nodes: [
      { id: "c", type: "custom", name: "값", position: pos, config: { code: "return { rows: [{ 주문: 'A1' }, { 주문: 'A2' }] };", outputs: ["rows"] } },
      { id: "save", type: "fileWrite", name: "저장", position: pos, config: { data: "{{ $input.rows }}", target: { kind: "file", name: "orders", format: "csv", mode: "overwrite" } } },
      { id: "read", type: "fileRead", name: "읽기", position: pos, config: { source: { scope: "flow", name: "orders", format: "csv", pick: { kind: "latest" } } } },
    ], edges: [{ id: "e1", from: { node: "c", port: "out" }, to: { node: "save" } }, { id: "e2", from: { node: "save", port: "out" }, to: { node: "read" } }] } });
    expect((await call("PUT", "/api/flows/w-file/run-on", { on: `worker:${wid}` })).body).toEqual({ runOn: `worker:${wid}` });
    expect((await call("GET", "/api/flows/w-file")).body.runOn).toBe(`worker:${wid}`);
    const run = await runOf("w-file");
    expect(run.status, run.message).toBe("success");
    expect(run.ranOn).toBe("파일 PC");
    expect(run.result.nodes.find((n: any) => n.id === "read").output.count).toBe(2);
    const uid = (await call("GET", "/api/flows/w-file")).body.uid;
    expect(readFileSync(join(dir, "files", uid, "orders.csv"), "utf8")).toContain("A2");
  }, 30_000);

  it("★라벨로 · 이번만 다른 곳 — 「server」는 서버에서", async () => {
    await call("POST", "/api/flows", { draft: custom("w-label", "return { n: 1 };") });
    expect((await runOf("w-label")).ranOn).toBeNull();
    expect((await runOf("w-label", { on: "label:엑셀" })).ranOn).toBe("파일 PC");
    await call("PUT", "/api/flows/w-label/run-on", { on: "label:엑셀" });
    expect((await runOf("w-label", { on: "server" })).ranOn).toBeNull();
    expect((await call("POST", "/api/flows/w-label/runs", { version: "draft", on: "label:없는라벨" })).body.error).toMatch(/라벨 «없는라벨»이 붙은 워커가 없습니다/);
  }, 30_000);

  it("★워커가 다른 워크플로우를 부른다 — 부른 실행은 서버에서 돈다", async () => {
    await call("POST", "/api/flows", { draft: custom("w-child", "return { n: 7 };") });
    await call("POST", "/api/flows", { draft: { schemaVersion: 1, id: "w-parent", name: "w-parent", nodes: [{ id: "call", type: "flowCall", name: "부르기", position: pos, config: { flowId: "w-child", version: "draft", items: "", params: {} } }], edges: [] } });
    const run = await runOf("w-parent", { on: `worker:${wid}` });
    expect(run.status, run.message).toBe("success");
    expect(run.ranOn).toBe("파일 PC");
    expect(JSON.stringify(run.result.output)).toContain("7");
  }, 30_000);
});

describe("못 갈 때 · 자리 · 멈추기 · 끊김", () => {
  it("★꺼져 있으면 기다리지 않고 바로 실패 — 까닭을 사람 말로 · 잠시 끈 워커도", async () => {
    const { worker } = await newWorker("꺼진 PC");
    await call("POST", "/api/flows", { draft: custom("w-off", "return { n: 1 };") });
    await call("PUT", "/api/flows/w-off/run-on", { on: `worker:${worker.id}` });
    const run = await runOf("w-off");
    expect(run.status).toBe("failure");
    expect(run.message).toMatch(/워커 «꺼진 PC»가 연결돼 있지 않습니다 — 그 PC에서 워커 프로그램을 켜세요/);
    await call("PUT", `/api/workers/${worker.id}`, { enabled: false });
    expect((await runOf("w-off")).message).toMatch(/잠시 꺼 두었습니다/);
  }, 30_000);

  it("★자리가 차면 줄을 선다 — 동시 실행 수만큼 · 줄 선 것도 멈출 수 있다", async () => {
    const { worker, token } = await newWorker("느린 PC", { slots: 1 });
    const a = await agentFor(token);
    await call("POST", "/api/flows", { draft: custom("w-slow", "await new Promise((r) => setTimeout(r, 600)); return { n: 1 };") });
    await call("PUT", "/api/flows/w-slow/run-on", { on: `worker:${worker.id}` });
    const ids = await Promise.all([1, 2, 3].map(async () => (await call("POST", "/api/flows/w-slow/runs", { version: "draft" })).body.runId as string));
    await until(() => a.running.length === 1);
    const live = (await call("GET", "/api/workers")).body.workers.find((x: any) => x.id === worker.id);
    expect(live.running).toHaveLength(1);
    expect(live.queued).toBe(2);
    expect((await call("POST", `/api/runs/${ids[2]}/cancel`)).status).toBe(202);
    for (const id of ids) await app.runs.wait(id);
    const rows = await Promise.all(ids.map(async (id) => (await call("GET", `/api/runs/${id}`)).body));
    expect(rows.map((r) => r.status)).toEqual(["success", "success", "cancelled"]);
    expect(rows[2].message).toMatch(/워커 차례를 기다리던 중/);
  }, 30_000);

  it("★도는 실행을 멈춘다 · 연결이 끊기면 «끊김»으로 실패", async () => {
    const { worker, token } = await newWorker("끊길 PC");
    const a = await agentFor(token);
    await call("POST", "/api/flows", { draft: custom("w-long", "await new Promise((r) => setTimeout(r, 3000)); return { n: 1 };") });
    await call("PUT", "/api/flows/w-long/run-on", { on: `worker:${worker.id}` });
    const r1 = (await call("POST", "/api/flows/w-long/runs", { version: "draft" })).body.runId;
    await until(() => a.running.length === 1);
    await call("POST", `/api/runs/${r1}/cancel`);
    await app.runs.wait(r1);
    expect((await call("GET", `/api/runs/${r1}`)).body.status).toBe("cancelled");
    const r2 = (await call("POST", "/api/flows/w-long/runs", { version: "draft" })).body.runId;
    await until(() => a.running.length === 1);
    await a.close();
    await app.runs.wait(r2);
    const row = (await call("GET", `/api/runs/${r2}`)).body;
    expect(row.status).toBe("failure");
    expect(row.message).toMatch(/워커 «끊길 PC»와 연결이 끊겼습니다/);
  }, 30_000);

  it("★새 토큰을 받으면 옛 연결은 끊기고 다시 붙지 못한다 · 워크플로우가 남은 워커는 지우지 않는다", async () => {
    const { worker, token } = await newWorker("토큰 PC");
    const a = await agentFor(token);
    const fresh = (await call("POST", `/api/workers/${worker.id}/token`)).body.token;
    await until(() => a.state === "denied");
    await agentFor(fresh);
    await call("POST", "/api/flows", { draft: custom("w-keep", "return { n: 1 };") });
    await call("PUT", "/api/flows/w-keep/run-on", { on: `worker:${worker.id}` });
    expect((await call("DELETE", `/api/workers/${worker.id}`)).status).toBe(409);
    await call("PUT", "/api/flows/w-keep/run-on", { on: null });
    expect((await call("DELETE", `/api/workers/${worker.id}`)).status).toBe(204);
  }, 30_000);
});

describe("팀 · 파일 경계", () => {
  it("★팀 전용 워커는 그 팀 · 공용 워크플로우만", async () => {
    const t = (await call("POST", "/api/teams", { name: "주문팀" })).body.id;
    const u = (await call("POST", "/api/teams", { name: "영업팀" })).body.id;
    const { worker } = await newWorker("주문팀 PC", { team: t, labels: ["주문"] });
    await call("POST", "/api/flows", { draft: custom("w-sales", "return { n: 1 };"), team: u });
    await call("POST", "/api/flows", { draft: custom("w-claim", "return { n: 1 };"), team: t });
    expect((await call("PUT", "/api/flows/w-sales/run-on", { on: `worker:${worker.id}` })).body.error).toMatch(/주문팀 전용 워커/);
    expect((await call("PUT", "/api/flows/w-sales/run-on", { on: "label:보상" })).body.error).toMatch(/라벨 «보상»이 붙은 워커가 없습니다/);
    expect((await call("PUT", "/api/flows/w-claim/run-on", { on: `worker:${worker.id}` })).status).toBe(200);
    expect((await call("PUT", "/api/flows/w-claim/team", { team: u })).body.error).toMatch(/먼저 «어디서 돌리나»를 바꾸세요/);
  });

  it("★워커는 그 실행이 닿는 폴더만 — 남의 워크플로우 폴더는 못 읽고, 공유는 된다", async () => {
    const { worker, token } = await newWorker("말하는 PC");
    await call("POST", "/api/flows", { draft: custom("w-raw", "return { n: 1 };") });
    await call("PUT", "/api/flows/w-raw/run-on", { on: `worker:${worker.id}` });
    const other = (await call("GET", "/api/flows/w-label")).body.uid;
    mkdirSync(join(dir, "files", other), { recursive: true });
    mkdirSync(join(dir, "files", "shared"), { recursive: true });
    writeFileSync(join(dir, "files", other, "secret.csv"), "x\n1\n");
    writeFileSync(join(dir, "files", "shared", "s.csv"), "y\n2\n");
    // 워커 프로그램 대신 말을 직접 한다
    const ws = new WebSocket(app.url.replace("http", "ws") + "/api/workers/connect", { headers: { authorization: `Bearer ${token}` } });
    const inbox: any[] = [];
    ws.on("message", (d) => inbox.push(JSON.parse(String(d))));
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ t: "hello", protocol: 1, host: "test", version: "v", extensions: [] }));
    await until(() => inbox.some((m) => m.t === "welcome"));
    const r = (await call("POST", "/api/flows/w-raw/runs", { version: "draft" })).body.runId;
    await until(() => inbox.some((m) => m.t === "job"));
    const job = inbox.find((m) => m.t === "job").job;
    expect(job).not.toHaveProperty("on");
    const ask = async (id: number, path: string, fn = "read") => { ws.send(JSON.stringify({ t: "ask", id, runId: r, op: "file", fn, path })); await until(() => inbox.some((m) => m.t === "reply" && m.id === id)); return inbox.find((m) => m.t === "reply" && m.id === id); };
    expect((await ask(1, `${other}/secret.csv`)).error).toMatch(/닿을 수 없는 폴더/);
    expect((await ask(2, "../t.db")).error).toMatch(/닿을 수 없는 폴더/);
    expect((await ask(3, "shared/s.csv")).value).toContain("y");
    expect((await ask(4, `${job.flowUid}/new.txt`, "stat")).value).toBeNull();
    ws.send(JSON.stringify({ t: "done", runId: r, result: { runId: r, flowId: "w-raw", status: "success", message: "", output: {}, nodes: [], startedAt: new Date().toISOString(), ms: 1 } }));
    await app.runs.wait(r);
    expect((await call("GET", `/api/runs/${r}`)).body).toMatchObject({ status: "success", ranOn: "말하는 PC" });
    ws.close();
    expect(existsSync(join(dir, "files", job.flowUid, "new.txt"))).toBe(false);
  }, 30_000);
});
