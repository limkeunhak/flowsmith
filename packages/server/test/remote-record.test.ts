/**
 * 그 PC에서 녹화(PLAN §28) — Studio가 «worker:<id>»로 녹화를 열면 그 PC의 워커 프로그램이 그 PC의 크롬에 붙어 녹화한다.
 * 서버는 잇기만 한다. «사람의 크롬»은 원격 디버깅 포트를 연 Chromium으로 흉내 낸다 —
 * 사람은 **자기 크롬 창에서 직접** 넣고 누르고, 녹화된 동작이 Studio에 온다.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { chromium, type BrowserContext, type Page } from "playwright";
import { startTestSite, type TestSite } from "@flowsmith/testsite";
import type { ClientMessage, ServerMessage } from "@flowsmith/recorder/protocol";
import { InProcessWorker, WorkerAgent } from "@flowsmith/worker";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";

const PORT = 9500 + Math.floor(Math.random() * 200);
let site: TestSite;
let app: App;
let dir: string;
let profile: string;
let human: BrowserContext;
let humanTab: Page;
let agent: WorkerAgent;
let wid: string;

const draft = () => ({
  schemaVersion: 1, id: "attach-login", name: "사람의 크롬 로그인", description: "", params: [], vars: {}, secrets: [], edges: [],
  settings: { forbiddenLabels: [], defaultTimeoutMs: 15000, monitorIntervalMin: null, probeParams: {}, browser: "attach", schedules: [] },
  nodes: [{ id: "n", type: "web", name: "로그인", position: { x: 0, y: 0 }, config: { start: { kind: "tab", match: new URL(site.url).host }, actions: [] } }],
}) as any;

function live() {
  const ws = new WebSocket(`${app.url.replace("http", "ws")}/api/live`, { origin: app.url });
  const msgs: ServerMessage[] = [];
  let frames = 0;
  ws.on("message", (d, binary) => { if (binary) frames++; else msgs.push(JSON.parse(String(d))); });
  const send = (m: ClientMessage) => ws.send(JSON.stringify(m));
  const until = async (pred: (m: ServerMessage[]) => boolean, ms = 20_000) => {
    const t0 = Date.now();
    while (!pred(msgs)) { if (Date.now() - t0 > ms) throw new Error(`기다리다 지쳤습니다: ${JSON.stringify(msgs.slice(-5))}`); await new Promise((r) => setTimeout(r, 50)); }
  };
  const opened = new Promise((r) => ws.on("open", r));
  return { ws, msgs, send, until, opened, frames: () => frames };
}
const openReq = (on: string): ClientMessage => ({ t: "open", flowId: "attach-login", nodeId: "n", draft: draft(), params: {}, replay: false, replayExisting: false, viewport: { width: 900, height: 600 }, on });

beforeAll(async () => {
  site = await startTestSite(0);
  dir = mkdtempSync(join(tmpdir(), "flowsmith-remote-rec-"));
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), monitor: false, schedule: false, retention: false });
  await fetch(`${app.url}/api/flows`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft: draft() }) });
  // 사람의 크롬 — 사이트를 열어 둔다
  profile = mkdtempSync(join(tmpdir(), "human-chrome-"));
  human = await chromium.launchPersistentContext(profile, { args: [`--remote-debugging-port=${PORT}`], viewport: { width: 1000, height: 700 } });
  humanTab = human.pages()[0] ?? await human.newPage();
  await humanTab.goto(`${site.url}/login`);
  // 그 PC의 워커 — 잠시 꺼 둔 «녹화용» PC(실행은 받지 않는다)
  const r = await (await fetch(`${app.url}/api/workers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "김담당 PC" }) })).json() as { worker: { id: string }; token: string };
  wid = r.worker.id;
  await fetch(`${app.url}/api/workers/${wid}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) });
  agent = new WorkerAgent({ server: app.url, token: r.token, worker: new InProcessWorker({ cdpUrl: `http://127.0.0.1:${PORT}` }), reconnect: false, log: () => undefined });
  await agent.start();
}, 60_000);
afterAll(async () => {
  await agent?.close();
  await human?.close();
  await app?.close();
  await site?.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
});

describe("그 PC에서 녹화", () => {
  it("★사람이 자기 크롬 창에서 넣고 누르면 Studio에 녹화된다 — 서버는 잇기만 · 잠시 끈 워커도 녹화는 된다", async () => {
    const c = live();
    await c.opened;
    c.send(openReq(`worker:${wid}`));
    await c.until((m) => m.some((x) => x.t === "phase" && x.phase === "ready"));
    expect(c.msgs.find((m) => m.t === "page")).toMatchObject({ url: expect.stringContaining("/login") });
    expect(agent.recordings).toBe(1);
    const w = (await (await fetch(`${app.url}/api/workers`)).json() as { workers: { id: string; recording: number }[] }).workers.find((x) => x.id === wid)!;
    expect(w.recording).toBe(1);

    // 사람 — 자기 크롬에서 직접
    await humanTab.bringToFront();
    await humanTab.fill("#uid", "kim");
    await humanTab.click("button");
    await c.until((m) => m.some((x) => x.t === "recorded" && x.item.action.kind === "click"));
    const kinds = c.msgs.flatMap((m) => (m.t === "recorded" ? [m.item.action.kind] : []));
    expect(kinds).toContain("fill");
    await expect.poll(() => c.frames()).toBeGreaterThan(0);   // 화면도 Studio로 온다

    // Studio가 닫으면 그 PC의 녹화도 닫힌다 · 사람의 탭은 그대로
    c.ws.close();
    await expect.poll(() => agent.recordings).toBe(0);
    expect(humanTab.isClosed()).toBe(false);
  }, 60_000);

  it("★워커가 없거나 꺼져 있으면 열지 못한다 — 까닭을 사람 말로", async () => {
    const off = await (await fetch(`${app.url}/api/workers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "꺼진 PC" }) })).json() as { worker: { id: string } };
    const c = live();
    await c.opened;
    c.send(openReq(`worker:${off.worker.id}`));
    await c.until((m) => m.some((x) => x.t === "phase" && x.phase === "closed"));
    expect(c.msgs.find((m) => m.t === "notice")).toMatchObject({ level: "error", text: expect.stringMatching(/워커 «꺼진 PC»가 연결돼 있지 않습니다/) });
  }, 30_000);
});
