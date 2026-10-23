/**
 * 플러그인을 워커에 나눠 주기(PLAN §41 · §26) — 서버가 켜 둔 목록을 알리면 워커가 묶음을 받아(해시 확인) 싣는다.
 * ★PC마다 손으로 깔지 않는다 · 새 버전도 저절로 · 그 확장이 없는 워커로는 보내지 않는다 · 받은 것은 그 PC에 남는다(다시 받지 않는다).
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InProcessWorker, WorkerAgent, writePackage } from "@flowsmith/worker";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { caller, until } from "./helpers.ts";

const code = (v: string) => `
import { hostname } from "node:os";
export const extensions = [{
  id: "demo.where", title: "어디서", description: "", options: [], outputs: ["v", "pid"], browser: "none", risk: "safe",
  async run() { return { v: "${v}", pid: process.pid > 0 && hostname().length > 0 }; },
}];`;
const pkg = (version: string) => writePackage({ id: "demo", name: "데모", version, description: "", main: "index.mjs", nodes: ["demo.where"] }, new Map([["index.mjs", Buffer.from(code(version))]]));

let app: App;
let dir: string;
let cache: string;
const agents: WorkerAgent[] = [];
const call = caller(() => app.url);
const upload = (buf: Buffer) => fetch(`${app.url}/api/plugins`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(buf) }).then((r) => r.status);
const flow = { schemaVersion: 1, id: "where", name: "어디서", nodes: [{ id: "x", type: "extension", name: "어디서", position: { x: 0, y: 0 }, config: { extension: "demo.where", options: {}, outputs: ["v", "pid"] } }], edges: [] };
const run = async () => {
  const r = await call("POST", "/api/flows/where/runs", { version: "draft" });
  await app.runs.wait(r.body.runId);
  return (await call("GET", `/api/runs/${r.body.runId}`)).body;
};
const workerView = async (id: string) => ((await call("GET", "/api/workers")).body.workers as { id: string; info: { extensions: string[]; plugins?: Record<string, string> } | null }[]).find((w) => w.id === id)!;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-plugin-workers-"));
  cache = join(dir, "worker-cache");
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), monitor: false, schedule: false, plugins: { dir: join(dir, "plugins"), requireSigned: false, keys: [] } });
  await call("POST", "/api/flows", { draft: flow });
});
afterAll(async () => {
  for (const a of agents) await a.close();
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("워커에 나눠 주기", () => {
  it("★붙으면 받아서 싣는다 → 그 워커에서 돈다 · 새 버전도 저절로", async () => {
    expect(await upload(pkg("1.0.0"))).toBe(201);
    const { worker, token } = (await call("POST", "/api/workers", { name: "담당 PC" })).body;
    await call("PUT", "/api/flows/where/run-on", { on: `worker:${worker.id}` });
    const agent = new WorkerAgent({ server: app.url, token, worker: new InProcessWorker(), reconnect: false, log: () => undefined, pluginsDir: cache });
    agents.push(agent);
    await agent.start();
    await until(async () => (await workerView(worker.id)).info?.plugins?.["demo"] === "1.0.0");
    expect((await workerView(worker.id)).info?.extensions).toEqual(["demo.where"]);
    expect(existsSync(join(cache, "demo", "1.0.0.fspkg"))).toBe(true);
    const r1 = await run();
    expect(r1.status).toBe("success");
    expect(r1.ranOn?.name ?? r1.ranOn).toMatch(/담당 PC/);
    expect(r1.result.nodes[0].output.v).toBe("1.0.0");

    expect(await upload(pkg("1.1.0"))).toBe(201);
    await until(async () => (await workerView(worker.id)).info?.plugins?.["demo"] === "1.1.0");
    expect((await run()).result.nodes[0].output.v).toBe("1.1.0");
  });

  it("★끄면 워커에서도 내린다 — 그 확장이 없는 워커로는 보내지 않고 까닭을 말한다", async () => {
    await call("PUT", "/api/plugins/demo", { enabled: false });
    const w = (await call("GET", "/api/workers")).body.workers[0];
    await until(async () => (await workerView(w.id)).info?.extensions.length === 0);
    const r = await run();
    expect(r.status).toBe("failure");
    expect(JSON.stringify(r)).toMatch(/확장 «?demo\.where»?|demo\.where/);
    await call("PUT", "/api/plugins/demo", { enabled: true });
    await until(async () => (await workerView(w.id)).info?.plugins?.["demo"] === "1.1.0");
  });

  it("다시 붙으면 그 PC에 남은 묶음을 쓴다(다시 받지 않는다)", async () => {
    const w = (await call("GET", "/api/workers")).body.workers[0];
    await agents[0]!.close();
    const token = (await call("POST", `/api/workers/${w.id}/token`)).body.token;
    const got: string[] = [];
    const again = new WorkerAgent({ server: app.url, token, worker: new InProcessWorker(), reconnect: false, log: (t) => got.push(t), pluginsDir: cache });
    agents.push(again);
    await again.start();
    await until(async () => (await workerView(w.id)).info?.plugins?.["demo"] === "1.1.0");
    expect(got.some((t) => /받는 중/.test(t))).toBe(false);
    expect((await run()).result.nodes[0].output.v).toBe("1.1.0");
  });
});
