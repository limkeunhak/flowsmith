/**
 * 웹에서 «내 PC에서 실행하기»(2026-10-25 · DESKTOP.md §15) — 데스크톱 앱 없이도.
 * 관리자가 내 개인 워커를 만들고 → 내 PC에 워커 프로그램(여기서는 같은 프로세스의 WorkerAgent)이 붙으면 →
 * 웹 편집 화면의 실행 단추에 «내 PC에서 실행하기»가 나오고, 켜고 돌리면 그 PC에서 · 끄면 서버에서 돈다.
 * ★남(주인이 아닌 사람)의 화면에는 나오지 않는다.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { generateKey, InProcessWorker, SecretBox, startApp, type App } from "@flowsmith/server";
import { WorkerAgent } from "@flowsmith/worker";

const root = fileURLToPath(new URL("..", import.meta.url));
let app: App;
let browser: Browser;
let page: Page;
let dir: string;
let agent: WorkerAgent | null = null;

const inPage = <T,>(p: Page, fn: (a: any) => Promise<T>, arg?: unknown) => p.evaluate(fn as never, arg) as Promise<T>;
const call = (p: Page, method: string, path: string, body?: unknown) => inPage<{ status: number; body: any }>(p, async ([m, u, b]: [string, string, unknown]) => {
  const r = await fetch(u, { method: m, headers: { "content-type": "application/json" }, ...(b ? { body: JSON.stringify(b) } : {}) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [method, path, body ?? null]);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-mypc-ui-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), staticDir: join(dir, "dist"), monitor: false, schedule: false, retention: false, auth: { enabled: true } });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
  await page.goto(app.url);
  await inPage(page, async (token: string) => {
    await fetch("/api/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, email: "boss@x.com", name: "김관리", password: "longpassword1" }) });
  }, app.auth.setupToken);
  expect((await call(page, "POST", "/api/flows", { draft: {
    schemaVersion: 1, id: "pc-job", name: "내 PC에서 할 일",
    nodes: [{ id: "c", type: "custom", name: "값", position: { x: 0, y: 0 }, config: { code: "return { n: 1 };", outputs: ["n"] } }], edges: [],
  } })).status).toBe(201);
}, 60_000);
afterAll(async () => {
  await agent?.close();
  await browser?.close();
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("웹 — 내 PC에서 실행하기", () => {
  it("★내 개인 워커가 붙어 있을 때만 칸이 나오고 · 켜면 그 PC에서 · 끄면 서버에서", async () => {
    // 첫 관리자를 만든 뒤라 다시 읽는다(주소의 # 뒤만 바뀌면 페이지가 새로 뜨지 않는다)
    await page.goto(`${app.url}/#/flows/pc-job`);
    await page.reload();
    await page.locator(".run-btn").waitFor({ timeout: 20_000 });
    // 아직 내 PC가 없다 — 칸이 없다
    expect(await page.locator(".run-mine").count()).toBe(0);

    const made = await call(page, "POST", "/api/workers", { name: "김관리 노트북", kind: "personal", owner: "boss@x.com" });
    expect(made.status).toBe(201);
    agent = new WorkerAgent({ server: app.url, token: made.body.token, worker: new InProcessWorker(), reconnect: false, log: () => undefined, pluginsDir: join(dir, "wp") });
    await agent.start();

    await page.reload();
    const box = page.locator(".run-mine input");
    await box.waitFor({ timeout: 20_000 });
    if (!(await box.isChecked())) await box.check();
    await expect.poll(() => page.locator(".run-btn").innerText()).toContain("내 PC");
    await page.locator(".run-btn").click();
    await expect.poll(async () => (await call(page, "GET", "/api/flows/pc-job/runs?limit=1")).body?.[0]?.ranOn, { timeout: 20_000 }).toBe("김관리 노트북");

    await box.uncheck();
    await page.locator(".run-btn").click();
    await expect.poll(async () => { const r = (await call(page, "GET", "/api/flows/pc-job/runs?limit=1")).body?.[0]; return r && r.status !== "running" ? r.ranOn ?? "서버" : null; }, { timeout: 20_000 }).toBe("서버");
  }, 90_000);

  it("남(주인이 아닌 사람)의 실행 단추에는 나오지 않는다", async () => {
    const u = (await call(page, "POST", "/api/users", { email: "lee@x.com", name: "이편집", role: "editor" })).body;
    // 따로 브라우저(쿠키가 섞이지 않게) · 임시 비밀번호는 먼저 바꾼다(바꾸기 화면이 먼저 뜬다)
    const other = await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
    await other.goto(app.url);
    expect((await call(other, "POST", "/api/auth/login", { email: "lee@x.com", password: u.tempPassword })).status).toBe(200);
    expect((await call(other, "POST", "/api/auth/password", { current: u.tempPassword, next: "anotherpassword1" })).status).toBeLessThan(300);
    await other.goto(`${app.url}/#/flows/pc-job`);
    await other.reload();
    await other.locator(".run-btn").waitFor({ timeout: 20_000 });
    await other.waitForTimeout(1500);
    expect(await other.locator(".run-mine").count()).toBe(0);
    await other.context().close();
  }, 60_000);
});
