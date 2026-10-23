/**
 * API 화면 e2e — 사이드바에서 열면 Swagger UI가 서버의 명세로 그려지고 «Try it out»이 지금 로그인으로 불린다 ·
 * 내 토큰 만들기(값은 한 번) → 그 토큰으로 밖에서 부르기 → 지우기.
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
const shots = process.env["FLOWSMITH_SHOTS"];
let app: App;
let browser: Browser;
let page: Page;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-api-ui-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), staticDir: join(dir, "dist"), monitor: false, schedule: false, retention: false, auth: { enabled: true } });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(app.url);
  // 첫 관리자 — 로그인 쿠키가 이 브라우저에 심긴다
  await page.evaluate(async (token) => {
    await fetch("/api/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, email: "boss@x.com", name: "김관리", password: "longpassword1" }) });
  }, app.auth.setupToken);
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("API 화면", () => {
  it("★사이드바 → API 목록(Swagger) → Try it out이 지금 로그인으로 불린다", async () => {
    await page.goto(app.url);
    await page.locator(".side").getByRole("link", { name: "API" }).click();
    expect(page.url()).toContain("#/api");
    await expect.poll(() => page.locator(".swagger-ui .opblock-tag").count(), { timeout: 15_000 }).toBeGreaterThan(8);
    expect(await page.locator(".swagger-ui .opblock-tag").allInnerTexts()).toEqual(expect.arrayContaining([expect.stringContaining("워크플로우"), expect.stringContaining("API 토큰")]));
    expect(await page.locator(".api-start").innerText()).toContain("Authorization: Bearer fsa_");
    if (shots) await page.screenshot({ path: join(shots, "api-list.png") });

    const op = page.locator(".opblock.opblock-get", { has: page.locator(".opblock-summary-path", { hasText: /^\/api\/flows$/ }) }).first();
    await op.locator(".opblock-summary-control").click();
    await op.getByRole("button", { name: "Try it out" }).click();
    await op.getByRole("button", { name: "Execute" }).click();
    await expect.poll(() => op.locator(".live-responses-table tbody .response-col_status").first().innerText(), { timeout: 10_000 }).toContain("200");
    if (shots) await page.screenshot({ path: join(shots, "api-try.png") });
  }, 60_000);

  it("★내 토큰 — 만들면 한 번만 보이고, 그 토큰으로 밖에서 부르고, 지우면 끝", async () => {
    await page.getByRole("tab", { name: "내 토큰" }).click();
    expect(page.url()).toContain("#/api/tokens");
    await page.getByRole("button", { name: /토큰 만들기/ }).click();
    await page.locator("form .field", { hasText: "이름" }).locator("input").fill("사내 대시보드");
    await page.locator("form .field", { hasText: "역할" }).locator("select").selectOption("viewer");
    await page.getByRole("button", { name: "만들기", exact: true }).click();
    const token = (await page.locator(".token-banner code.token").innerText()).trim();
    expect(token).toMatch(/^fsa_/);
    expect(await page.locator(".token-banner code.cmd").first().innerText()).toContain(`Bearer ${token}`);
    await expect.poll(() => page.locator(".token-row").count()).toBe(1);
    expect(await page.locator(".token-row").innerText()).toContain("보는 사람");
    if (shots) await page.screenshot({ path: join(shots, "api-tokens.png") });

    // 밖에서(쿠키 없이) — 보기는 되고 바꾸기는 역할이 모자란다
    const h = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    expect((await fetch(`${app.url}/api/flows`, { headers: h })).status).toBe(200);
    expect((await fetch(`${app.url}/api/flows`, { method: "POST", headers: h, body: "{}" })).status).toBe(403);

    await page.getByRole("button", { name: "사내 대시보드 지우기" }).click();
    await page.locator(".token-row").getByRole("button", { name: "지우기", exact: true }).click();
    await expect.poll(() => page.locator(".token-row").count()).toBe(0);
    expect((await fetch(`${app.url}/api/flows`, { headers: h })).status).toBe(401);
  }, 60_000);

  it("어둡게도 읽힌다", async () => {
    if (!shots) return;
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`${app.url}/#/api`);
    await expect.poll(() => page.locator(".swagger-ui .opblock-tag").count(), { timeout: 15_000 }).toBeGreaterThan(8);
    await page.locator(".opblock.opblock-post").first().locator(".opblock-summary-control").click();
    await page.screenshot({ path: join(shots, "api-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
  }, 60_000);
});
