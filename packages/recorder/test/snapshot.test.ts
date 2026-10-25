/**
 * 화면 요약(snapshot.ts · PLAN §42-8) — 진짜 Chromium · 시험 사이트.
 * ★요소마다 «그 요소 하나만 가리키는» 위치만 남는다 · 표는 행 · 열로 · 넣은 값 · 비밀번호는 요약에 없다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { startTestSite, type TestSite } from "@flowsmith/testsite";
import { build } from "@flowsmith/engine";
import { pageSnapshot } from "../src/index.ts";

let site: TestSite;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  site = await startTestSite(0);
  browser = await chromium.launch();
  page = await browser.newPage();
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await site?.close();
});

describe("화면 요약", () => {
  it("★로그인 화면 — 칸 · 단추가 하나로 가리키는 위치와 함께 · 넣은 비밀번호는 없다", async () => {
    await page.goto(`${site.url}/login`);
    await page.fill("#pw", "secret-pw-123");
    const s = await pageSnapshot(page);
    expect(s.title).toBeTruthy();
    const kinds = s.elements.map((e) => e.kind);
    expect(kinds).toContain("input");
    expect(kinds).toContain("button");
    for (const e of s.elements.filter((x) => x.target)) {
      expect(e.target!.locators.length).toBeGreaterThan(0);
      for (const l of e.target!.locators) expect(await build(page, l).count()).toBe(1);
    }
    expect(JSON.stringify(s)).not.toContain("secret-pw-123");
    const btn = s.elements.find((e) => e.kind === "button")!;
    await build(page, btn.target!.locators[0]!).click();   // 그 위치로 실제로 누를 수 있다
    await page.waitForURL(/\/(login|home)/);
  });

  it("★표 — 행 위치 · 열 이름으로(몸통 행은 표 하나로 묶인다)", async () => {
    await page.goto(`${site.url}/login`);
    await page.fill("#uid", "kim");
    await page.fill("#pw", "p@ss");
    await page.click("button");
    await page.waitForURL(/\/home/);
    await page.goto(`${site.url}/orders?no=A-1001`);
    const s = await pageSnapshot(page);
    const table = s.elements.find((e) => e.kind === "table");
    expect(table?.table?.columns.map((c) => c.name)).toEqual(["품목", "수량", "금액"]);
    // 읽을 글자 — 주문 상태(«배송중»)가 하나로 가리키는 위치와 함께
    const status = s.elements.find((e) => e.kind === "text" && e.text === "배송중");
    expect(status?.target?.locators[0]).toBeTruthy();
    // 몸통 행 안의 칸은 따로 나오지 않는다(표로)
    expect(s.elements.some((e) => e.kind === "text" && e.text === "연필")).toBe(false);
    expect(await page.locator(table!.table!.rows.locators[0]!.value).count()).toBeGreaterThan(1);
    expect(s.elements.length).toBeLessThanOrEqual(160);
  });
});
