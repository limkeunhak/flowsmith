/**
 * 빈 워크플로우 e2e(2026-10-20) — «빈 워크플로우»를 누르면 바로 만들어 캔버스로 가고 이름을 묻는다.
 * 만들기 → 그 이름으로 저장 · 그만두기 → 방금 만든 빈 워크플로우를 지우고 목록으로. 다시 열면 묻지 않는다.
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
const flows = () => fetch(`${app.url}/api/flows`).then((r) => r.json() as Promise<{ id: string; name: string }[]>);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-blank-ui-"));
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

describe("빈 워크플로우 — 바로 캔버스로 · 이름은 창에서", () => {
  it("만들기 — 적은 이름으로 저장되고, 다시 열면 묻지 않는다", async () => {
    await page.goto(`${app.url}/#/`);
    await page.getByRole("button", { name: "빈 워크플로우", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "새 워크플로우 이름" });
    await dialog.waitFor();
    expect(page.url()).toMatch(/#\/flows\/flow/);
    const input = dialog.getByLabel("워크플로우 이름");
    expect(await input.inputValue()).toBe("새 워크플로우");
    await input.fill("주문 상태 확인");
    await input.press("Enter");
    await dialog.waitFor({ state: "hidden" });
    // ★«저장됨»은 저장 전부터 떠 있다 — 서버에 이름이 들어갈 때까지 기다린다
    await expect.poll(async () => (await flows()).map((f) => f.name)).toEqual(["주문 상태 확인"]);
    await expect.poll(() => page.getByLabel("워크플로우 이름").inputValue()).toBe("주문 상태 확인");
    await page.getByText("저장됨", { exact: true }).waitFor();
    await page.reload();
    await page.getByLabel("워크플로우 이름").waitFor();
    expect(await page.getByRole("dialog").count()).toBe(0);
  });

  it("그만두기 · Esc — 빈 워크플로우를 지우고 목록으로", async () => {
    await page.goto(`${app.url}/#/`);
    await page.getByRole("button", { name: /빈 워크플로우에서/ }).click();
    const dialog = page.getByRole("dialog", { name: "새 워크플로우 이름" });
    await dialog.waitFor();
    expect(await flows()).toHaveLength(2);
    await dialog.getByRole("button", { name: "그만두기" }).click();
    await page.waitForURL(/#\/$/);
    expect((await flows()).map((f) => f.name)).toEqual(["주문 상태 확인"]);

    await page.getByRole("button", { name: "빈 워크플로우", exact: true }).click();
    await dialog.waitFor();
    await page.keyboard.press("Escape");
    await page.waitForURL(/#\/$/);
    expect(await flows()).toHaveLength(1);
  });
});

describe("복제 — 목록의 복제 단추", () => {
  it("★«이름 (사본)»으로 새 워크플로우를 만들고 그 캔버스로 — 원래 것은 그대로 · 이름을 묻지 않는다", async () => {
    await page.goto(`${app.url}/#/`);
    const row = page.locator(".flow-row", { hasText: "주문 상태 확인" }).first();
    await row.waitFor();
    const before = (await flows()).length;
    await row.getByRole("button", { name: /^복제/ }).click();
    await expect.poll(() => page.url()).toMatch(/#\/flows\/flow[^/]*-copy$/);
    await expect.poll(() => page.getByLabel("워크플로우 이름").inputValue()).toBe("주문 상태 확인 (사본)");
    expect(await page.getByRole("dialog").count()).toBe(0);
    const list = await flows();
    expect(list).toHaveLength(before + 1);
    expect(list.map((f) => f.name)).toEqual(expect.arrayContaining(["주문 상태 확인", "주문 상태 확인 (사본)"]));
  });
});
