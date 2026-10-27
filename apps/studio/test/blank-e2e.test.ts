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
const flows = () => fetch(`${app.url}/api/flows`).then((r) => r.json() as Promise<{ id: string; name: string; group: string | null }[]>);

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
    // 워크플로우가 있으면 템플릿(«빈 워크플로우에서» 칸)은 템플릿 화면에만
    await page.goto(`${app.url}/#/templates`);
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

describe("목록 정돈 — 묶음", () => {
  it("★이름 앞말이 같은 것을 묶음으로 정리하자고 하고 · 골라서 새 묶음으로 옮긴다(초안은 그대로)", async () => {
    const draft = (id: string, name: string) => ({ schemaVersion: 1, id, name, nodes: [], edges: [] });
    for (const [id, name] of [["g-a", "주문 · 조회"], ["g-b", "주문 · 취소"], ["g-c", "주문 · 환불"]] as const) {
      await fetch(`${app.url}/api/flows`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft: draft(id, name) }) });
    }
    await page.goto(`${app.url}/#/`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator(".flow-suggest", { hasText: "주문 3" }).waitFor();
    await page.getByRole("button", { name: "묶음으로 정리" }).click();
    const group = page.locator(".flow-group", { has: page.locator(".flow-group-toggle", { hasText: "주문" }) });
    await group.waitFor();
    // 묶음 안에서는 앞말을 뗀다
    expect(await group.locator(".flow-label").allInnerTexts()).toEqual(expect.arrayContaining(["조회", "취소", "환불"]));
    expect(await page.locator(".flow-suggest").count()).toBe(0);

    await group.locator(".flow-row", { hasText: "환불" }).getByRole("checkbox").check();
    await page.getByRole("button", { name: "묶음 옮기기" }).click();
    await page.getByLabel("새 묶음 이름").fill("돈");
    await page.getByRole("button", { name: "옮기기", exact: true }).click();
    await expect.poll(async () => (await flows()).filter((f) => f.id.startsWith("g-")).map((f) => `${f.id}:${f.group}`).sort())
      .toEqual(["g-a:주문", "g-b:주문", "g-c:돈"]);
    await page.locator(".flow-group-toggle", { hasText: "돈" }).waitFor();
    // 묶음은 초안 밖 — 초안에는 group이 없다
    const d = await fetch(`${app.url}/api/flows/g-c`).then((r) => r.json() as Promise<{ draft: Record<string, unknown> }>);
    expect("group" in d.draft).toBe(false);
  });
});
