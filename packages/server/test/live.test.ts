/**
 * 라이브 패널 WebSocket — 화면이 보내는 것(좌표 마우스 · 글자)만으로 녹화가 되는가.
 * 좌표는 같은 크기의 참조 페이지에서 잰다(같은 뷰포트면 배치가 같다).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { chromium, type Browser } from "playwright";
import { startTestSite, type TestSite } from "@flowsmith/testsite";
import type { ClientMessage, ServerMessage } from "@flowsmith/recorder/protocol";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { InProcessWorker } from "../src/run/worker.ts";

let site: TestSite;
let app: App;
let dir: string;
let browser: Browser;

const example = (): any => {
  const j = JSON.parse(readFileSync(fileURLToPath(new URL("../../../examples/login-and-read.json", import.meta.url)), "utf8"));
  j.vars.baseUrl = site.url;
  return j;
};

beforeAll(async () => {
  site = await startTestSite(0);
  dir = mkdtempSync(join(tmpdir(), "flowsmith-live-"));
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker() });
  await fetch(`${app.url}/api/flows`, { method: "POST", body: JSON.stringify({ draft: example() }) });
  await fetch(`${app.url}/api/flows/login-and-read/secrets/shop`, { method: "PUT", body: JSON.stringify({ value: { username: "kim", password: "p@ss" } }) });
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await app?.close();
  await site?.close();
  rmSync(dir, { recursive: true, force: true });
});

function connect(origin?: string) {
  const ws = new WebSocket(`${app.url.replace("http", "ws")}/api/live`, origin ? { origin } : {});
  const msgs: ServerMessage[] = [];
  let frames = 0;
  ws.on("message", (d, binary) => { if (binary) frames++; else msgs.push(JSON.parse(String(d))); });
  const send = (m: ClientMessage) => ws.send(JSON.stringify(m));
  const until = async (pred: (m: ServerMessage[]) => boolean, ms = 15_000) => {
    const t0 = Date.now();
    while (!pred(msgs)) { if (Date.now() - t0 > ms) throw new Error(`기다리다 지쳤습니다: ${JSON.stringify(msgs.slice(-5))}`); await new Promise((r) => setTimeout(r, 50)); }
  };
  return { ws, msgs, send, until, frames: () => frames };
}

describe("라이브 패널", () => {
  it("★다른 출처에서는 붙을 수 없다", async () => {
    const ws = new WebSocket(`${app.url.replace("http", "ws")}/api/live`, { origin: "https://evil.example" });
    const err = await new Promise<string>((resolve) => { ws.on("unexpected-response", (_q, r) => resolve(String(r.statusCode))); ws.on("error", (e) => resolve(e.message)); });
    expect(err).toMatch(/403/);
  });

  it("★좌표 마우스와 글자만으로 넣기 · 누르기가 녹화된다", async () => {
    // 참조 페이지 — 같은 크기로 로그인해 주문 조회 화면에서 좌표를 잰다
    const ref = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await ref.goto(`${site.url}/login`);
    await ref.fill("#uid", "kim"); await ref.fill("#pw", "p@ss"); await ref.click("button");
    await ref.goto(`${site.url}/orders`);
    const field = (await ref.getByPlaceholder("주문번호").boundingBox())!;
    const button = (await ref.getByRole("button", { name: "조회" }).boundingBox())!;
    await ref.close();

    const draft = example();
    draft.nodes[1].config.actions = [];
    draft.nodes[1].config.start = { kind: "url", url: "{{ $vars.baseUrl }}/orders" };
    const c = connect(app.url);
    await new Promise((r) => c.ws.on("open", r));
    c.send({ t: "open", flowId: "login-and-read", nodeId: "search", draft, params: {}, replay: true, replayExisting: false, viewport: { width: 1280, height: 800 } });
    await c.until((m) => m.some((x) => x.t === "phase" && x.phase === "ready"));
    await c.until(() => c.frames() > 0);
    expect(c.msgs.some((m) => m.t === "page" && m.url.includes("/orders"))).toBe(true);

    const at = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    const click = (p: { x: number; y: number }) => {
      c.send({ t: "mouse", type: "down", ...p, button: "left", clickCount: 1 });
      c.send({ t: "mouse", type: "up", ...p, button: "left", clickCount: 1 });
    };
    click(at(field));
    c.send({ t: "text", text: "A-1001" });
    click(at(button));
    await c.until((m) => m.some((x) => x.t === "page" && x.url.includes("no=A-1001")));
    // 누르기는 해 본 뒤에 남는다(팝업이 열리는지 보고) — 조금 늦게 온다
    await c.until((m) => m.filter((x) => x.t === "recorded").length >= 2);
    const recorded = c.msgs.flatMap((m) => (m.t === "recorded" ? [m.item.action.kind] : []));
    expect(recorded).toEqual(["fill", "click"]);
    c.ws.close();
  }, 40_000);
});
