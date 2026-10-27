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

describe("뒤로 · 앞으로 — 주소가 화면을 따른다", () => {
  const draft = { schemaVersion: 1, id: "nav-a", name: "길 찾기", nodes: [
    { id: "h1", type: "http", name: "첫 API", position: { x: 0, y: 0 }, config: { method: "GET", url: "https://api.example/a" } },
    { id: "h2", type: "http", name: "둘째 API", position: { x: 260, y: 0 }, config: { method: "GET", url: "https://api.example/b" } },
  ], edges: [{ id: "e1", from: { node: "h1", port: "out" }, to: { node: "h2" } }] };
  const hash = async () => new URL(page.url()).hash;

  it("★시트 · 실행 기록 탭이 주소에 남고 · 뒤로 가기가 시트를 닫고 탭을 돌린다(시트 안에서 단계를 오가도 한 번)", async () => {
    await fetch(`${app.url}/api/flows`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft }) });
    await page.goto(`${app.url}/#/`);
    await page.goto(`${app.url}/#/flows/nav-a`);
    await page.locator(".relay-node", { hasText: "첫 API" }).click();
    await expect.poll(hash).toBe("#/flows/nav-a/nodes/h1");
    await page.locator(".sheet-step", { hasText: "둘째 API" }).click();
    await expect.poll(hash).toBe("#/flows/nav-a/nodes/h2");
    await page.goBack();
    await expect.poll(hash).toBe("#/flows/nav-a");
    expect(await page.locator(".ndv.sheet").count()).toBe(0);
    await page.goForward();
    await page.locator(".ndv.sheet").waitFor();

    await page.keyboard.press("Escape");
    await expect.poll(hash).toBe("#/flows/nav-a");
    await page.getByRole("button", { name: "실행 기록", exact: true }).click();
    await expect.poll(hash).toBe("#/flows/nav-a/runs");
    await page.goBack();
    await expect.poll(hash).toBe("#/flows/nav-a");
    await page.locator(".react-flow").waitFor();
  });

  it("★저장하지 않은 고침 — 뒤로 · 위 메뉴로 떠나려 하면 묻고, 머무르면 고침이 그대로", async () => {
    await page.goto(`${app.url}/#/flows/nav-a`);
    await page.getByLabel("워크플로우 이름").fill("길 찾기 (고침)");
    await page.locator(".topbar .save-state", { hasText: "저장 안 됨" }).waitFor();
    const asked: string[] = [];
    const stay = (d: import("playwright").Dialog) => { asked.push(d.message()); void d.dismiss(); };
    page.on("dialog", stay);
    await page.locator(".appbar-nav").getByRole("link", { name: "대시보드" }).click();
    await expect.poll(() => asked.length).toBe(1);
    await page.goBack();
    await expect.poll(() => asked.length).toBe(2);
    page.off("dialog", stay);
    expect(asked[0]).toMatch(/저장하지 않은 고침/);
    expect(await hash()).toBe("#/flows/nav-a");
    expect(await page.getByLabel("워크플로우 이름").inputValue()).toBe("길 찾기 (고침)");

    const go = (d: import("playwright").Dialog) => void d.accept();
    page.on("dialog", go);
    await page.locator(".appbar-nav").getByRole("link", { name: "대시보드" }).click();
    await expect.poll(hash).toBe("#/dashboard");
    page.off("dialog", go);
  });

  it("탭 제목은 화면마다 · 모르는 주소는 «없는 화면»(어느 길도 켜지 않는다) · 목록은 돌아오면 찾던 말 그대로", async () => {
    await page.goto(`${app.url}/#/flows/nav-a`);
    await expect.poll(() => page.title()).toBe("길 찾기 · Flowsmith");
    await page.goto(`${app.url}/#/oops`);
    await page.getByText("없는 화면입니다").waitFor();
    expect(await page.title()).toBe("없는 화면 · Flowsmith");
    expect(await page.locator(".appbar a.on").count()).toBe(0);
    await page.goto(`${app.url}/#/`);
    await page.getByPlaceholder("이름 · 설명으로 찾기").fill("길 찾기");
    await page.locator(".flow-row", { hasText: "길 찾기" }).first().click();
    await expect.poll(hash).toBe("#/flows/nav-a");
    await page.goBack();
    await expect.poll(() => page.getByPlaceholder("이름 · 설명으로 찾기").inputValue()).toBe("길 찾기");
    await page.getByPlaceholder("이름 · 설명으로 찾기").fill("");
  });

  it("빈 워크플로우의 이름을 묻는 중에 뒤로 가면 — 지운다(빈 것이 쌓이지 않게)", async () => {
    await page.goto(`${app.url}/#/templates`);
    const before = (await flows()).length;
    await page.getByRole("button", { name: /빈 워크플로우에서/ }).click();
    await page.getByRole("dialog", { name: "새 워크플로우 이름" }).waitFor();
    expect(await flows()).toHaveLength(before + 1);
    await page.goBack();
    await expect.poll(async () => (await flows()).length).toBe(before);
  });
});
