/**
 * 사내 서버형 화면 e2e — 첫 관리자(설정 토큰) → 사람 들이기(임시 비밀번호) → 로그아웃 → 보는 사람으로 로그인(임시 비밀번호 바꾸기) → 보기 전용.
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
  dir = mkdtempSync(join(tmpdir(), "flowsmith-auth-ui-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), staticDir: join(dir, "dist"), monitor: false, schedule: false, retention: false, auth: { enabled: true } });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("로그인 화면", () => {
  it("★첫 관리자 → 사람 들이기 → 로그아웃 → 보는 사람으로 들어가 임시 비밀번호를 바꾸고 → 보기 전용", async () => {
    await page.goto(app.url);
    await page.getByRole("heading", { name: "첫 관리자 만들기" }).waitFor();
    const field = (label: string) => page.locator(".field", { hasText: label }).locator("input");
    await field("설정 토큰").fill(app.auth.setupToken!);
    await field("이름").fill("김관리");
    await field("메일").fill("boss@x.com");
    await field("비밀번호(8자 이상)").fill("longpassword1");
    await field("한 번 더").fill("longpassword1");
    await page.getByRole("button", { name: "만들고 들어가기" }).click();
    await page.getByRole("heading", { name: "워크플로우", exact: true }).waitFor();
    expect(await page.locator(".side").innerText()).toContain("김관리");

    // 사람 들이기 — 임시 비밀번호는 한 번만
    await page.locator(".side").getByRole("link", { name: "사람" }).click();
    await page.getByRole("button", { name: /사람 들이기/ }).click();
    await page.locator("form .field", { hasText: "메일" }).locator("input").fill("see@x.com");
    await page.locator("form .field", { hasText: "이름" }).locator("input").fill("이보기");
    await page.getByRole("button", { name: "들이기", exact: true }).click();
    const temp = (await page.locator(".banner.warn code.token").innerText()).trim();
    expect(temp).toMatch(/^\w{4}-\w{4}-\w{4}$/);
    await expect.poll(() => page.locator(".user-row").count()).toBe(2);

    // 팀 — 이보기는 넣지 않은 «영업팀»을 만들고, 그 팀 플로우는 이보기에게 보이지 않는다
    await page.locator(".side").getByRole("link", { name: "팀" }).click();
    await page.getByPlaceholder("새 팀 이름 — 예: 주문팀").fill("영업팀");
    await page.getByRole("button", { name: /팀 만들기/ }).click();
    await page.locator(".team-card").waitFor();
    expect(await page.locator(".team-card").innerText()).toContain("아직 사람이 없습니다");
    const teamId = await page.evaluate(async () => ((await (await fetch("/api/teams")).json()) as { id: string }[])[0]!.id);
    await page.evaluate((team) => fetch("/api/flows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ team, draft: { schemaVersion: 1, id: "sales", name: "영업팀 워크플로우", nodes: [], edges: [] } }) }), teamId);

    // 편집자가 아니면 막힐 공용 플로우 하나
    await page.evaluate(() => fetch("/api/flows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft: { schemaVersion: 1, id: "f1", name: "보기만 할 워크플로우", nodes: [], edges: [] } }) }));

    // 로그아웃
    await page.locator(".side-me").click();
    await page.getByRole("button", { name: "로그아웃" }).click();
    await page.getByRole("heading", { name: "로그인", exact: true }).waitFor();

    // 보는 사람 — 임시 비밀번호로 들어오면 먼저 바꾼다
    await field("메일").fill("see@x.com");
    await field("비밀번호").fill("틀린비밀번호");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    expect(await page.locator(".banner.bad").innerText()).toMatch(/맞지 않습니다/);
    await field("비밀번호").fill(temp);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.getByRole("heading", { name: "비밀번호 바꾸기" }).waitFor();
    await field("받은 임시 비밀번호").fill(temp);
    await field("새 비밀번호(8자 이상)").fill("seepassword9");
    await field("한 번 더").fill("seepassword9");
    await page.getByRole("button", { name: "바꾸기", exact: true }).click();
    await page.getByRole("heading", { name: "워크플로우", exact: true }).waitFor();
    expect(await page.locator(".side").getByRole("link", { name: "사람" }).count()).toBe(0);    // 관리자가 아니다

    // 팀 — 공용은 보이고 남의 팀 것은 없다
    await page.locator(".flow-row").first().waitFor();
    expect(await page.locator(".flow-row").allInnerTexts()).toEqual([expect.stringContaining("보기만 할 워크플로우")]);
    expect(await page.locator(".flow-row .team-pill").innerText()).toBe("공용");

    // 보기 전용
    await page.locator(".flow-row", { hasText: "보기만 할 워크플로우" }).click();
    await page.locator(".readonly-banner").waitFor();
    expect(await page.locator(".readonly-banner").innerText()).toContain("보는 사람");
    expect(await page.getByRole("button", { name: "저장" }).count()).toBe(0);
    expect(await page.locator(".topbar button.primary").isDisabled()).toBe(true);
  }, 60_000);
});
