/**
 * 테스트(Suite) 화면 e2e(2026-10-19) — 검사 노드 설정 · Suite 만들기 · 시나리오 넣기 · 전체 실행 · 판정(통과 · 불통과 · 오류) · 불통과 화면 · 단건.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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
let site: Server;
const api = (method: string, path: string, body?: unknown) => fetch(`${app.url}${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).then((r) => r.status === 204 ? null : r.json() as Promise<any>);
const pos = (x: number) => ({ x, y: 0 });
const target = (label: string, css: string) => ({ label, locators: [{ kind: "css", value: css }], fingerprint: null, frames: [], verifiedAt: null });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-suite-ui-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  site = createServer((_q, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<!doctype html><meta charset="utf-8"><h1>주문 결과</h1><b id="price">651,170원</b>`); });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), staticDir: join(dir, "dist"), monitor: false, schedule: false, retention: false });
  const order = (id: string, name: string, op: string, expected: string) => ({
    schemaVersion: 1, id, name, settings: { defaultTimeoutMs: 3000 },
    nodes: [
      { id: "w", type: "web", name: "주문 읽기", position: pos(0), config: { start: { kind: "url", url }, actions: [{ id: "a1", kind: "read", output: "price", target: target("금액", "#price") }] } },
      { id: "k", type: "check", name: "검사", position: pos(300), config: { items: [{ id: "k1", label: "금액", actual: "{{ $input.price }}", op, expected }] } },
    ],
    edges: [{ id: "e1", from: { node: "w", port: "out" }, to: { node: "k" } }],
  });
  for (const f of [order("q-ok", "주문 — 60만 원 이상", "gte", "600000"), order("q-bad", "주문 — 50만 원 미만", "lt", "500000"),
    { schemaVersion: 1, id: "q-err", name: "사이트 죽음", nodes: [{ id: "c", type: "custom", name: "c", position: pos(0), config: { code: "throw new Error('연결 안 됨');", outputs: [] } }], edges: [] }]) {
    await api("POST", "/api/flows", { draft: f });
    await api("POST", `/api/flows/${f.id}/versions`, { note: "" });
    await api("POST", `/api/flows/${f.id}/deploy`, { version: 1 });
  }
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await app?.close();
  await new Promise((r) => site?.close(r));
  rmSync(dir, { recursive: true, force: true });
});

describe("테스트 화면", () => {
  it("★검사 노드 — 항목 · 견주는 법 · 기대값을 고친다", async () => {
    await page.goto(`${app.url}/#/flows/q-ok`);
    await page.locator(".relay-node", { hasText: "검사" }).click();
    const item = page.locator(".check-item").first();
    await item.waitFor();
    expect(await item.getByLabel("견주는 법").inputValue()).toBe("gte");
    await page.getByRole("button", { name: "＋ 검사" }).click();
    await expect.poll(() => page.locator(".check-item").count()).toBe(2);
    await page.locator(".check-item").nth(1).getByLabel("검사 이름").fill("제목");
    await page.locator(".check-item").nth(1).getByLabel("견주는 법").selectOption("notEmpty");
    if (shots) await page.screenshot({ path: join(shots, "check-node.png") });
    await page.keyboard.press("Escape");
  }, 60_000);

  it("★★Suite — 만들고 · 시나리오 셋 · 저장 · 전체 실행 → 통과 · 불통과(화면) · 오류 · 단건", async () => {
    await page.goto(`${app.url}/#/tests`);
    await page.getByLabel("Suite 이름").fill("주문 회귀");
    await page.getByRole("button", { name: /Suite 만들기/ }).click();
    await page.locator(".suite-page").waitFor();
    for (const name of ["주문 — 60만 원 이상", "주문 — 50만 원 미만", "사이트 죽음"]) {
      await page.getByRole("button", { name: "시나리오", exact: true }).click();
      await page.locator(".scenario").last().getByLabel("워크플로우").selectOption({ label: `${name} (v1)` });
    }
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect.poll(() => page.locator(".save-state.dirty").count()).toBe(0);
    await page.getByRole("button", { name: /전체 실행/ }).click();
    const detail = page.locator(".suite-run-detail");
    await expect.poll(async () => detail.locator(".suite-result .pill").allInnerTexts(), { timeout: 30_000 }).toEqual(["통과", "불통과", "오류"]);
    expect(await detail.locator(".row").first().innerText()).toMatch(/불통과.*통과 1 · 불통과 1 · 오류 1/s);
    const bad = detail.locator(".suite-result.v-fail");
    expect(await bad.innerText()).toMatch(/금액: 기대 «500000 보다 작다», 실제 «651,170원»/);
    await bad.locator(".suite-shot img").waitFor();
    await expect.poll(() => bad.locator(".suite-shot img").evaluate((el) => (el as unknown as { naturalWidth: number }).naturalWidth)).toBeGreaterThan(0);
    expect(await detail.locator(".suite-result.v-error").innerText()).toMatch(/연결 안 됨/);
    if (shots) await page.screenshot({ path: join(shots, "suite-run.png") });

    // 실행 기록 → 그 실행의 검사 표 · 화면
    await bad.getByRole("link", { name: /실행 기록/ }).click();
    await page.locator(".runlog").waitFor({ timeout: 15_000 });
    await page.locator(".runlog-item", { hasText: "검사" }).click();
    await page.locator(".check-table tr.bad", { hasText: "금액" }).waitFor();
    await page.locator(".check-shot img").waitFor();
    if (shots) await page.screenshot({ path: join(shots, "suite-check-run.png") });

    // 단건 — 첫 시나리오만
    await page.goBack();
    await page.locator(".suite-page").waitFor();
    await page.locator(".scenario").first().getByTitle("이 시나리오만 돌리기").click();
    await expect.poll(async () => page.locator(".suite-run-detail .suite-result").count(), { timeout: 20_000 }).toBe(1);
    await expect.poll(async () => page.locator(".suite-run-detail .suite-result .pill").first().innerText(), { timeout: 20_000 }).toBe("통과");
    const list = await api("GET", "/api/suites");
    expect(list[0]).toMatchObject({ name: "주문 회귀", lastRun: { only: expect.any(String), status: "pass" } });
  }, 120_000);
});
