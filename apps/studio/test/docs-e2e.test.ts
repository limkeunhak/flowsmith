/**
 * 가이드 화면 e2e — 앱 막대에서 열고 · 목차로 옮기고 · 찾고 · «이 페이지에서» · 이전/다음 · 문서마다 제목이 있다.
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

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-docs-ui-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), staticDir: join(dir, "dist"), monitor: false, schedule: false, retention: false });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("가이드", () => {
  it("★앱 막대에서 열고 · 목차 · 찾기 · 이 페이지에서 · 다음", async () => {
    await page.goto(app.url);
    await page.locator(".appbar").getByRole("link", { name: "가이드" }).click();
    await expect.poll(() => page.locator(".doc h1").innerText()).toBe("시작하기");
    expect(await page.locator(".doc table").count()).toBeGreaterThan(0);

    await page.locator(".docs-group a", { hasText: "워커" }).click();
    await expect.poll(() => page.locator(".doc h1").innerText()).toBe("워커");
    expect(page.url()).toContain("#/docs/workers");
    // 코드 블록 둘 — 개인 워커(웹에서 내 PC) · 공용 워커 켜는 명령
    expect(await page.locator(".doc pre.doc-code").allInnerTexts()).toEqual([expect.stringContaining("packages/worker/src/main.ts"), expect.stringContaining("packages/worker/src/main.ts")]);
    await page.locator(".docs-toc .toc-item", { hasText: "실행 위치 고르기" }).click();
    await expect.poll(() => page.locator("#실행-위치-고르기").evaluate((el) => el.getBoundingClientRect().top), { timeout: 5000 }).toBeLessThan(200);   // 부드럽게 내려간다

    await page.locator(".docs-search input").fill("웹훅");
    await expect.poll(() => page.locator(".docs-found a").count()).toBeGreaterThan(1);
    await page.locator(".docs-found a", { hasText: "실행 · 일정 · 웹훅" }).click();
    await expect.poll(() => page.locator(".doc h1").innerText()).toBe("실행 · 일정 · 웹훅 · 이어서 돌리기");
    expect(await page.locator(".docs-found").count()).toBe(0);   // 찾기를 비운다

    await page.locator(".doc-pager a.next").click();
    await expect.poll(() => page.locator(".doc h1").innerText()).toBe("테스트(Suite)");
    await page.goto(`${app.url}/#/docs/없는문서`);
    await expect.poll(() => page.locator(".doc h1").innerText()).toBe("시작하기");
  }, 60_000);
});
