/**
 * 워커 화면 e2e — 워커 더하기(토큰은 한 번) → 그 토큰으로 워커가 붙으면 «연결됨» → 플로우 설정에서 그 워커를 고르면 거기서 돈다 →
 * 실행 단추에서 «이번만 서버».
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

const lastRun = async () => ((await (await fetch(`${app.url}/api/flows/pc-job/runs`)).json()) as { status: string; ranOn: string | null }[])[0];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-workers-ui-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), staticDir: join(dir, "dist"), filesDir: join(dir, "files"), monitor: false, schedule: false, retention: false });
  await fetch(`${app.url}/api/flows`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft: {
    schemaVersion: 1, id: "pc-job", name: "PC에서 할 일",
    nodes: [{ id: "c", type: "custom", name: "값", position: { x: 0, y: 0 }, config: { code: "return { n: 1 };", outputs: ["n"] } }], edges: [],
  } }) });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
}, 60_000);
afterAll(async () => {
  await agent?.close();
  await browser?.close();
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("워커 화면", () => {
  it("★워커를 더하고 붙이면 «연결됨» — 워크플로우가 그 워커에서 돌고, 이번만 서버로도", async () => {
    await page.goto(`${app.url}/#/workers`);
    await page.getByRole("heading", { name: "워커", exact: true }).waitFor();
    expect(await page.locator(".worker-card").first().innerText()).toContain("서버");
    await page.locator(".page-head").getByRole("button", { name: /워커 더하기/ }).click();
    await page.getByPlaceholder("예: 김담당 PC").fill("주문팀 PC");
    await page.getByPlaceholder("관리자화면, 크롬로그인").first().fill("쇼핑몰");
    await page.getByRole("button", { name: "만들고 토큰 받기" }).click();
    const token = (await page.locator(".token-banner code.token").innerText()).trim();
    expect(token).toMatch(/^fsw_/);
    expect(await page.locator(".token-banner").innerText()).toContain("지금 한 번만 표시됩니다");
    const card = page.locator(".worker-card", { hasText: "꺼짐" });
    await card.waitFor();

    agent = new WorkerAgent({ server: app.url, token, worker: new InProcessWorker(), reconnect: false, log: () => undefined });
    await agent.start();
    await expect.poll(() => page.locator(".worker-card").nth(1).innerText(), { timeout: 8000 }).toContain("연결됨");
    expect(await page.locator(".worker-card").nth(1).locator(".worker-meta").innerText()).toMatch(/연결됨 · .+ · \S+/);

    // 플로우 설정 — 어디서 돌리나
    const wid = ((await (await fetch(`${app.url}/api/workers`)).json()) as { workers: { id: string }[] }).workers[0]!.id;
    await page.goto(`${app.url}/#/flows/pc-job`);
    await page.getByTitle(/워크플로우 설정/).click();
    const where = page.locator(".field", { hasText: "일정 · 웹훅 · 점검도 여기서 실행합니다" }).locator("select");
    await where.selectOption(`worker:${wid}`);
    await expect.poll(async () => ((await (await fetch(`${app.url}/api/flows/pc-job`)).json()) as { runOn: string }).runOn).toBe(`worker:${wid}`);
    await page.keyboard.press("Escape");

    await page.locator(".run-btn").click();
    await expect.poll(async () => (await lastRun())?.ranOn, { timeout: 10_000 }).toBe("주문팀 PC");
    await expect.poll(async () => (await lastRun())?.status, { timeout: 10_000 }).toBe("success");   // 전체 시험 부하에서는 1초(기본)로 모자라다

    // 이번만 서버
    await page.locator(".run-more").click();
    await page.locator(".launcher-pop .field", { hasText: "실행 위치" }).locator("select").selectOption("server");
    expect(await page.locator(".run-btn").innerText()).toContain("서버");
    await page.locator(".run-btn").click();
    await expect.poll(async () => { const r = await lastRun(); return r?.status === "success" && r.ranOn === null; }, { timeout: 10_000 }).toBe(true);

    // 워커 화면 — 이 워커에서 도는 플로우 1
    await page.goto(`${app.url}/#/workers`);
    await expect.poll(() => page.locator(".worker-card").nth(1).innerText()).toContain("워크플로우 1");
  }, 60_000);
});
