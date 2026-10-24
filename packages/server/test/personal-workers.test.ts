/**
 * 워커 두 종류 · 실행 화면 중계 (2026-10-24, PLAN §44 · 4단계).
 *   공용 워커 — 누구의 실행이든(도커 · 서버실 PC) · 개인 워커 — 주인이 «내 PC에서 실행하기»로 돌린 실행만(데스크톱 앱).
 *   워커에서 도는 실행도 «실제 화면 보기» · 사람 기다리기가 된다 — 화면은 그 PC가 서버로 보내 준다(보는 사람이 있을 때만).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startTestSite, type TestSite } from "@flowsmith/testsite";
import { InProcessWorker, WorkerAgent } from "@flowsmith/worker";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { caller, until } from "./helpers.ts";

const call = caller(() => app.url);
let site: TestSite;
let app: App;
let dir: string;
let admin = "";
let kim = "";
let lee = "";
const agents: WorkerAgent[] = [];
const pos = { x: 0, y: 0 };

const css = (label: string, value: string) => ({ label, locators: [{ kind: "css", value }], fingerprint: null, frames: [], verifiedAt: null });
const custom = (id: string) => ({ schemaVersion: 1, id, name: id, nodes: [{ id: "c", type: "custom", name: "c", position: pos, config: { code: "return { n: 1 };", outputs: ["n"] } }], edges: [] });
const portal = () => ({
  schemaVersion: 1, id: "portal", name: "포털",
  nodes: [{ id: "w", type: "web", name: "포털 읽기", position: pos, config: {
    start: { kind: "url", url: `${site.url}/home` },
    actions: [
      { id: "h1", kind: "human", prompt: "로그인해 주세요", appears: css("로그인 단추", "button[type=submit]"), done: { kind: "visible", target: css("사용자 이름", "[data-testid=user-name]") } },
      { id: "r1", kind: "read", target: css("사용자 이름", "[data-testid=user-name]"), output: "name", strategy: "auto" },
    ],
  } }],
  edges: [],
});
const agentFor = async (token: string) => {
  const a = new WorkerAgent({ server: app.url, token, worker: new InProcessWorker(), reconnect: false, log: () => undefined, pluginsDir: join(dir, `plugins-${agents.length}`) });
  agents.push(a);
  await a.start();
  return a;
};
const finished = async (runId: string, cookie: string) => { await app.runs.wait(runId); return (await call("GET", `/api/runs/${runId}`, undefined, cookie)).body; };

function screen(runId: string, cookie: string) {
  const ws = new WebSocket(`${app.url.replace("http", "ws")}/api/runs/${runId}/screen`, { headers: { cookie } });
  const msgs: any[] = [];
  let frames = 0;
  ws.on("message", (d, binary) => { if (binary) frames++; else msgs.push(JSON.parse(String(d))); });
  const open = new Promise<void>((r) => ws.on("open", () => r()));
  const send = (m: unknown) => ws.send(JSON.stringify(m));
  const key = (k: string) => { send({ t: "key", type: "down", key: k }); send({ t: "key", type: "up", key: k }); };
  const login = (id: string, pw: string) => { key("Tab"); send({ t: "text", text: id }); key("Tab"); send({ t: "text", text: pw }); key("Enter"); };
  return { ws, msgs, open, login, frames: () => frames, human: () => msgs.filter((m) => m.t === "human").at(-1) };
}

beforeAll(async () => {
  site = await startTestSite(0);
  dir = mkdtempSync(join(tmpdir(), "flowsmith-personal-"));
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), monitor: false, schedule: false, retention: false, auth: { enabled: true } });
  admin = (await call("POST", "/api/auth/setup", { token: app.auth.setupToken, email: "boss@x.com", name: "대표", password: "longpassword1" })).cookie!;
  for (const [email, name] of [["kim@x.com", "김철수"], ["lee@x.com", "이영희"]] as const) {
    const u = (await call("POST", "/api/users", { email, name, role: "editor" }, admin)).body;
    const c = (await call("POST", "/api/auth/login", { email, password: u.tempPassword })).cookie!;
    if (email === "kim@x.com") kim = c; else lee = c;
  }
  for (const f of [custom("job"), portal()]) expect((await call("POST", "/api/flows", { draft: f }, admin)).status).toBe(201);
}, 60_000);
afterAll(async () => {
  for (const a of agents) await a.close();
  await app?.close();
  await site?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("개인 워커 — 주인이 «내 PC에서»로 돌린 실행만", () => {
  let mine = "";
  it("★만들 때 주인을 고른다 · 라벨은 붙지 않는다 · 주인과 관리자만 본다", async () => {
    expect((await call("POST", "/api/workers", { name: "김 PC", kind: "personal" }, admin)).status).toBe(400);
    expect((await call("POST", "/api/workers", { name: "김 PC", kind: "personal", owner: "nobody@x.com" }, admin)).status).toBe(400);
    const r = await call("POST", "/api/workers", { name: "김 PC", kind: "personal", owner: "KIM@x.com", labels: ["앱"] }, admin);
    expect(r.status).toBe(201);
    expect(r.body.worker).toMatchObject({ kind: "personal", owner: "kim@x.com", labels: [], team: null });
    mine = r.body.worker.id;
    expect((await call("PUT", `/api/workers/${mine}`, { labels: ["앱"] }, admin)).status).toBe(400);
    await agentFor(r.body.token);
    const names = async (c: string) => ((await call("GET", "/api/workers", undefined, c)).body.workers as { name: string }[]).map((w) => w.name);
    expect(await names(admin)).toContain("김 PC");
    expect(await names(kim)).toContain("김 PC");
    expect(await names(lee)).not.toContain("김 PC");
  });

  it("★워크플로우의 «어디서 돌리나»로는 고를 수 없다 — 실행 한 번 · 주인만", async () => {
    const set = await call("PUT", "/api/flows/job/run-on", { on: `worker:${mine}` }, admin);
    expect(set.status).toBe(400);
    expect(set.body.error).toMatch(/개인 워커입니다 — 워크플로우를 맡기지 않습니다/);
    // 남(관리자도)의 실행은 받지 않는다
    const other = await call("POST", "/api/flows/job/runs", { version: "draft", on: `worker:${mine}` }, lee);
    expect(other.status).toBe(400);
    expect(other.body.error).toMatch(/kim@x\.com의 개인 워커입니다 — 그 사람이 직접 돌린 실행만/);
    expect((await call("POST", "/api/flows/job/runs", { version: "draft", on: `worker:${mine}` }, admin)).status).toBe(400);
    // 주인 — 그 PC에서 돈다
    const own = await call("POST", "/api/flows/job/runs", { version: "draft", on: `worker:${mine}` }, kim);
    expect(own.status).toBe(202);
    const row = await finished(own.body.runId, kim);
    expect(row).toMatchObject({ status: "success", ranOn: "김 PC", startedBy: "kim@x.com" });
  });

  it("라벨로는 개인 워커에 가지 않는다", async () => {
    const shared = (await call("POST", "/api/workers", { name: "도커 1", labels: ["도커"] }, admin)).body;
    expect(shared.worker).toMatchObject({ kind: "shared", owner: null });
    expect((await call("PUT", "/api/flows/job/run-on", { on: "label:도커" }, admin)).status).toBe(200);
    await agentFor(shared.token);
    const r = await call("POST", "/api/flows/job/runs", { version: "draft" }, lee);
    expect((await finished(r.body.runId, lee)).ranOn).toBe("도커 1");
    await call("PUT", "/api/flows/job/run-on", { on: null }, admin);
  });
});

describe("실행 화면 중계 — 공용 워커에서 도는 실행", () => {
  it("★보는 사람이 붙으면 그 PC가 화면을 보낸다 · 사람 기다리기 동안 화면에서 로그인하면 이어 간다", async () => {
    const w = (await call("POST", "/api/workers", { name: "도커 2", labels: ["화면"] }, admin)).body;
    await agentFor(w.token);
    expect((await call("PUT", "/api/flows/portal/run-on", { on: "label:화면" }, admin)).status).toBe(200);
    const { runId } = (await call("POST", "/api/flows/portal/runs", { version: "draft" }, kim)).body;
    await until(() => app.screens.waiting(runId), 30_000, "사람 기다리기가 시작되지 않았습니다");
    const see = screen(runId, kim);
    await see.open;
    await until(() => see.frames() > 0 && see.msgs.some((m) => m.t === "viewport") && see.msgs.some((m) => m.t === "page"), 15_000, "워커의 화면이 오지 않았습니다");
    expect(see.msgs.find((m) => m.t === "page").url).toContain("/login");
    expect(see.human()).toMatchObject({ prompt: "로그인해 주세요", control: true });
    see.login("kim", "p@ss");
    const row = await finished(runId, kim);
    expect(row.status, row.message).toBe("success");
    expect(row).toMatchObject({ ranOn: "도커 2", result: { output: { name: "김철수" } } });
    see.ws.close();
  }, 60_000);

  it("사람 기다리기가 시간을 넘겨 끝나도 — 보다가 떠난 사람이 있어도 서버는 그대로", async () => {
    const f = portal();
    f.id = "portal-short";
    (f.nodes[0]!.config.actions[0] as { timeoutMs?: number }).timeoutMs = 10_000;
    expect((await call("POST", "/api/flows", { draft: f }, admin)).status).toBe(201);
    expect((await call("PUT", "/api/flows/portal-short/run-on", { on: "label:화면" }, admin)).status).toBe(200);
    const { runId } = (await call("POST", "/api/flows/portal-short/runs", { version: "draft" }, kim)).body;
    await until(() => app.screens.waiting(runId), 30_000, "사람 기다리기가 시작되지 않았습니다");
    const see = screen(runId, kim);
    await see.open;
    await until(() => see.frames() > 0, 15_000, "워커의 화면이 오지 않았습니다");
    see.ws.close();
    const row = await finished(runId, kim);
    expect(row.status).toBe("failure");
    expect((await call("GET", "/api/workers", undefined, admin)).status).toBe(200);
  }, 60_000);
});
