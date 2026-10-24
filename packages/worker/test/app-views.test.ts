/**
 * 앱 안 브라우저(PLAN §44 · DESKTOP.md §4) — 데스크톱 앱 없이 흉내 낸다.
 * «앱»은 원격 디버깅 포트를 연 Chromium이다: 편집 화면 탭 하나가 늘 열려 있고, 워커가 부탁하면(ViewHost) 표시 주소로 탭 하나를 연다.
 *
 * ★워커는 자기가 연 뷰만 만진다 — 편집 화면 탭은 그대로 · 레코더도 심지 않는다 · 끝나면 뷰만 닫히고 앱의 컨텍스트는 산다.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type BrowserContext, type Page } from "playwright";
import { parseFlow } from "@flowsmith/core";
import { RecorderSession, type ServerMessage } from "@flowsmith/recorder";
import { startTestSite, type TestSite } from "@flowsmith/testsite";
import { AppViews, InProcessWorker, viewMarkUrl, type ViewRequest } from "../src/index.ts";

const PORT = 9500 + Math.floor(Math.random() * 200);
const CDP = `http://127.0.0.1:${PORT}`;
let site: TestSite;
let app: BrowserContext;
let editor: Page;
let profile: string;
/** 앱이 받은 부탁 · 연 뷰 */
const asked: ViewRequest[] = [];
const opened = new Map<string, Page>();

/** 앱 흉내 — view:open이면 탭 하나를 표시 주소로 열고 답한다 · view:close면 닫는다(view:focus는 받아 적기만) */
function fakeHost() {
  let reply: (m: unknown) => void = () => undefined;
  return {
    post(m: ViewRequest) {
      asked.push(m);
      void (async () => {
        if (m.t === "view:open") {
          const p = await app.newPage();
          await p.goto(viewMarkUrl(m.id));
          opened.set(m.id, p);
          reply({ t: "view:opened", id: m.id });
        } else if (m.t === "view:close") {
          await opened.get(m.id)?.close();
        }
      })();
    },
    onMessage(fn: (m: unknown) => void) { reply = fn; },
  };
}

beforeAll(async () => {
  site = await startTestSite(0);
  profile = mkdtempSync(join(tmpdir(), "fs-app-"));
  app = await chromium.launchPersistentContext(profile, { args: [`--remote-debugging-port=${PORT}`] });
  editor = app.pages()[0] ?? await app.newPage();
  await editor.setContent("<title>편집 화면</title><h1>편집 화면</h1>");
});
afterAll(async () => {
  await app?.close();
  await site?.close();
  rmSync(profile, { recursive: true, force: true });
});

const tgt = (label: string, css: string) => ({ label, locators: [{ kind: "css", value: css }], fingerprint: null, frames: [], verifiedAt: null });
const loginFlow = (browser: string) => parseFlow({
  schemaVersion: 1, id: "app-login", name: "앱 안 로그인",
  secrets: [{ name: "shop", kind: "login" }],
  settings: { browser },
  nodes: [{ id: "w", type: "web", name: "로그인 · 읽기", position: { x: 0, y: 0 }, config: {
    start: { kind: "url", url: `${site.url}/login` },
    actions: [
      { id: "u", kind: "fill", target: tgt("아이디", "#uid"), value: "{{ $secrets.shop.username }}" },
      { id: "p", kind: "fill", target: tgt("비밀번호", "#pw"), value: "{{ $secrets.shop.password }}" },
      { id: "b", kind: "click", target: tgt("로그인", "button") },
      { id: "r", kind: "read", output: "who", strategy: "text", target: tgt("사용자", "[data-testid=user-name]") },
    ],
  } }],
  edges: [],
});

describe("앱 안 브라우저", () => {
  it("★실행 — 앱에 뷰를 부탁해 그 뷰에서 돌고, 끝나면 뷰만 닫는다(편집 화면 · 앱은 그대로)", async () => {
    const views = new AppViews(CDP, fakeHost());
    const worker = new InProcessWorker({ appViews: views });
    expect(worker.capabilities).toContain("app");
    asked.length = 0;
    const r = await worker.run({ runId: "r1", flow: loginFlow("app"), params: {}, secrets: { shop: { username: "kim", password: "p@ss" } } } as never, () => undefined);
    expect(r.status, JSON.stringify(r.nodes.map((n) => n.failure))).toBe("success");
    expect(r.output).toEqual({ who: "김철수" });
    // 실행용 뷰 하나를 열고 · 닫았다
    expect(asked.map((m) => m.t)).toEqual(["view:open", "view:close"]);
    expect(asked[0]).toMatchObject({ purpose: "run", title: "앱 안 로그인" });
    const view = opened.get(asked[0]!.id)!;
    await expect.poll(() => view.isClosed()).toBe(true);
    // ★편집 화면 탭 · 앱(컨텍스트)은 그대로
    expect(editor.isClosed()).toBe(false);
    expect(await editor.title()).toBe("편집 화면");
    expect(app.pages()).toContain(editor);
    await worker.close();
  });

  it("★사람 기다리기 — 실행 창을 앞으로 부르고(view:focus) 사람이 그 뷰에서 로그인하면 이어 간다", async () => {
    const views = new AppViews(CDP, fakeHost());
    const worker = new InProcessWorker({ appViews: views });
    asked.length = 0;
    // 흉내 앱은 뷰가 컨텍스트 하나를 함께 쓴다(진짜 앱은 뷰마다 세션) — 앞 시험의 로그인을 지운다
    await app.clearCookies();
    const flow = parseFlow({
      schemaVersion: 1, id: "app-human", name: "사람이 로그인", settings: { browser: "app" },
      nodes: [{ id: "w", type: "web", name: "로그인 기다리기", position: { x: 0, y: 0 }, config: {
        start: { kind: "url", url: `${site.url}/login` },
        actions: [
          { id: "h", kind: "human", prompt: "로그인해 주세요", appears: null, done: { kind: "url", pattern: "/home" }, timeoutMs: 30_000 },
          { id: "r", kind: "read", output: "who", strategy: "text", target: tgt("사용자", "[data-testid=user-name]") },
        ],
      } }],
      edges: [],
    });
    const running = worker.run({ runId: "r3", flow, params: {}, secrets: {} } as never, () => undefined);
    await expect.poll(() => asked.some((m) => m.t === "view:focus"), { timeout: 15_000 }).toBe(true);
    const id = asked.find((m) => m.t === "view:open")!.id;
    expect(asked.find((m) => m.t === "view:focus")!.id).toBe(id);
    // 사람이 그 창에서 로그인한다
    const view = opened.get(id)!;
    await view.fill("#uid", "kim");
    await view.fill("#pw", "p@ss");
    await view.click("button");
    const r = await running;
    expect(r.status, JSON.stringify(r.nodes.map((n) => n.failure))).toBe("success");
    expect(r.output).toEqual({ who: "김철수" });
    await worker.close();
  });

  it("앱이 없는 워커 — 기다리지 않고 까닭과 함께 실패한다", async () => {
    const worker = new InProcessWorker();
    expect(worker.capabilities).not.toContain("app");
    const r = await worker.run({ runId: "r2", flow: loginFlow("app"), params: {}, secrets: { shop: { username: "kim", password: "p@ss" } } } as never, () => undefined);
    expect(r.status).toBe("failure");
    expect(r.message).toContain("데스크톱 앱");
    await worker.close();
  });

  it("★녹화 — 뷰 id를 화면에 알리고(화면 전송 없음) 사람이 뷰에서 누른 것을 녹화한다 · 편집 화면에는 레코더를 심지 않는다", async () => {
    const views = new AppViews(CDP, fakeHost());
    const worker = new InProcessWorker({ appViews: views });
    asked.length = 0;
    const msgs: ServerMessage[] = [];
    let frames = 0;
    const draft = {
      schemaVersion: 1, id: "rec", name: "앱 녹화", settings: { browser: "app" },
      nodes: [{ id: "w", type: "web", name: "주문", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: `${site.url}/login` }, actions: [] } }], edges: [],
    };
    const session = await RecorderSession.open(worker.appSource(draft), {
      t: "open", flowId: "rec", nodeId: "w", draft: draft as never, params: {}, replay: false, replayExisting: false, startMode: "record", viewport: { width: 1280, height: 800 },
    }, {}, { send: (m) => msgs.push(m), frame: () => { frames++; } });
    const id = asked[0]!.id;
    expect(asked[0]).toMatchObject({ t: "view:open", purpose: "record", title: "앱 녹화" });
    expect(msgs).toContainEqual({ t: "app-view", id });
    expect(msgs.some((m) => m.t === "phase" && m.phase === "ready")).toBe(true);
    // 사람이 뷰에서 직접 — 칸에 넣고 단추를 누른다(앱 쪽 연결로 · 녹화기를 거치지 않는 진짜 입력)
    const view = opened.get(id)!;
    await view.waitForURL(/\/login/);
    await view.click("#uid");
    await view.keyboard.type("kim");
    await view.click("#pw");
    await view.keyboard.type("p@ss");
    await view.click("button");
    await expect.poll(() => msgs.filter((m) => m.t === "recorded").map((m) => (m as Extract<ServerMessage, { t: "recorded" }>).item.action.kind), { timeout: 10_000 }).toContain("click");
    expect(frames).toBe(0);
    // ★편집 화면에는 레코더가 없다
    expect(await editor.evaluate(() => typeof (globalThis as { __relayEmit?: unknown }).__relayEmit)).toBe("undefined");
    await session.close();
    await expect.poll(() => view.isClosed()).toBe(true);
    expect(editor.isClosed()).toBe(false);
    await worker.close();
  });
});
