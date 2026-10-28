/**
 * 실행 로그 따라가기 e2e(2026-10-28) — 도는 노드를 저절로 고르고, 로그가 늘면 맨 아래로. 위로 올려 읽는 동안은 멈추고 «새 로그 N개»,
 * 누르면 다시 맨 아래 · 다른 노드를 고르면 따라가기를 그만둔다.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { generateKey, InProcessWorker, SecretBox, startApp, type App } from "@flowsmith/server";

const root = fileURLToPath(new URL("..", import.meta.url));
let app: App;
let browser: Browser;
let page: Page;
let dir: string;
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${app.url}/api${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const t = await r.text();
  return t ? JSON.parse(t) : null;
};
/** 상세 칸이 맨 아래에서 얼마나 떨어져 있나(px) */
const gap = () => page.locator(".runlog-detail").evaluate((e: any) => e.scrollHeight - e.scrollTop - e.clientHeight as number);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-follow-ui-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), staticDir: join(dir, "dist"), monitor: false, schedule: false, retention: false });
  browser = await chromium.launch();
  // 로그 칸이 작게 — 몇 줄만 쌓여도 스크롤이 생기게
  page = await browser.newPage({ viewport: { width: 1300, height: 700 } });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("실행 로그 — 따라가기", () => {
  it("★도는 노드를 고르고 맨 아래를 따라간다 · 올려 읽으면 «새 로그» · 누르면 돌아온다 · 다른 노드를 고르면 그만", async () => {
    const wait = (i: number) => ({ id: `w${i}`, kind: "wait", wait: { kind: "fixed", ms: 120 } });
    const draft = {
      schemaVersion: 1, id: "slow", name: "slow", edges: [{ id: "e1", from: { node: "a", port: "out" }, to: { node: "b" } }],
      nodes: [
        { id: "a", type: "web", name: "열기", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: "data:text/html,<p>x</p>" }, actions: [] } },
        { id: "b", type: "web", name: "오래 걸리는 일", position: { x: 300, y: 0 }, config: { start: { kind: "continue" }, actions: Array.from({ length: 90 }, (_, i) => wait(i)) } },
      ],
    };
    await call("POST", "/flows", { draft, team: null });
    const { runId } = await call("POST", "/flows/slow/runs", { version: "draft", params: {} });
    await page.goto(`${app.url}/#/flows/slow/runs/${runId}`);
    // 도는 노드가 저절로 골라진다
    await expect.poll(() => page.locator(".runlog-item.on").innerText().catch(() => ""), { timeout: 10_000 }).toContain("오래 걸리는 일");
    await expect.poll(() => page.locator(".runlog-follow").innerText()).toContain("따라가는 중");
    // 로그가 늘어도 맨 아래 — 스크롤이 생길 만큼 쌓인 뒤
    await expect.poll(() => page.locator(".runlog-detail .steps li").count(), { timeout: 10_000 }).toBeGreaterThan(30);
    await expect.poll(gap).toBeLessThan(48);
    // 위로 올려 읽는 동안 — 멈추고 «새 로그 N개»
    await page.locator(".runlog-detail").evaluate((e: any) => { e.scrollTop = 0; });
    await page.locator(".runlog-unseen").waitFor({ timeout: 5000 });
    expect(await gap()).toBeGreaterThan(48);
    expect(await page.locator(".runlog-unseen").innerText()).toMatch(/새 로그 \d+개/);
    await page.locator(".runlog-unseen").click();
    expect(await gap()).toBeLessThan(48);
    await expect.poll(() => page.locator(".runlog-unseen").count()).toBe(0);
    // 다른 노드를 고르면 따라가기를 그만둔다(그 노드에 머문다)
    await page.locator(".runlog-item", { hasText: "열기" }).click();
    await page.waitForTimeout(600);
    expect(await page.locator(".runlog-item.on").innerText()).toContain("열기");
    expect(await page.locator(".runlog-follow").innerText()).toContain("따라가기");
    // 다시 따라가기
    await page.locator(".runlog-follow").click();
    await expect.poll(() => page.locator(".runlog-item.on").innerText()).toContain("오래 걸리는 일");
  }, 60_000);
});
