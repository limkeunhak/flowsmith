/**
 * 웹페이지 노드 나누기 e2e(2026-10-22) — 사용자 «한 노드에 단계가 너무 많다 — 페이지 접속 → 로그인(사람 대기) → 주문 읽기처럼 나누고 싶다».
 * 오른쪽 클릭 «단계별로 나누기»(되돌리기) · 노드 창의 «단계별로 나누기» · 동작의 «여기서 나누기» · 노드 고르기의 «사람 기다리기».
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { checkFlow, type Flow } from "@flowsmith/core";
import { generateKey, InProcessWorker, SecretBox, startApp, type App } from "@flowsmith/server";

const root = fileURLToPath(new URL("..", import.meta.url));
let app: App;
let browser: Browser;
let page: Page;
let dir: string;

const t = (label: string) => ({ label, locators: [{ kind: "css", value: `#${label}` }], fingerprint: null, frames: [], verifiedAt: null });
const base = { risk: "safe", timeoutMs: null, optional: false };
const draft = {
  schemaVersion: 1, id: "split", name: "나누기 시험",
  nodes: [
    { id: "w", type: "web", name: "주문 읽기", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: "https://portal.example" }, actions: [
      { ...base, id: "h1", kind: "human", prompt: "포털에 로그인해 주세요", appears: null, done: { kind: "url", pattern: "^https://portal\\.example/home" } },
      { ...base, id: "c1", kind: "click", target: t("menu"), popup: false },
      { ...base, id: "r1", kind: "read", target: t("order"), output: "orders", strategy: "auto", attribute: null, transform: null },
    ] } },
    { id: "s", type: "fileWrite", name: "저장", position: { x: 260, y: 0 }, config: { data: "{{ $input.orders }}", target: { name: "주문", format: "csv" } } },
  ],
  edges: [{ id: "e1", from: { node: "w", port: "out" }, to: { node: "s" } }],
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-split-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), staticDir: join(dir, "dist"), monitor: false, schedule: false, retention: false });
  await fetch(`${app.url}/api/flows`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft }) });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

const tile = (name: string) => page.locator(".relay-node", { has: page.locator(".tile-name", { hasText: name }) });
const count = () => page.locator(".relay-node").count();
const names = () => page.locator(".relay-node .tile-name").allInnerTexts();
const saved = async () => ((await (await fetch(`${app.url}/api/flows/split`)).json()) as { draft: Flow }).draft;

describe("웹페이지 노드 나누기", () => {
  it("★오른쪽 클릭 «단계별로 나누기» — 페이지 접속 → 사람 기다리기 → 주문 읽기 · 되돌리기", async () => {
    await page.goto(`${app.url}/#/flows/split`);
    await tile("주문 읽기").waitFor();
    expect(await count()).toBe(2);
    await tile("주문 읽기").click({ button: "right" });
    await page.getByRole("menuitem", { name: "단계별로 나누기" }).click();
    await expect.poll(count).toBe(4);
    expect((await names()).sort()).toEqual(["사람 기다리기", "주문 읽기", "저장", "페이지 접속"].sort());
    // 사람 기다리기는 다른 얼굴 — 안내 문구가 보인다
    expect(await page.locator(".relay-node.t-human").count()).toBe(1);
    expect(await page.locator(".relay-node.t-human .tile-sub").innerText()).toContain("포털에 로그인해 주세요");
    expect(await tile("페이지 접속").locator(".tile-sub").innerText()).toContain("접속 · portal.example");
    const toast = page.getByRole("status");
    await toast.getByText(/노드를 3개로 나눴습니다/).waitFor();
    await toast.getByRole("button", { name: "되돌리기" }).click();
    await expect.poll(count).toBe(2);
  });

  it("★노드 창의 «단계별로 나누기» · 동작의 «여기서 나누기» → 저장 — 읽은 값이 뒤로 이어져 문제 없음", async () => {
    await tile("주문 읽기").hover();
    await tile("주문 읽기").getByRole("button", { name: "설정 열기" }).click();
    await page.getByRole("button", { name: "단계별로 나누기" }).click();
    await expect.poll(count).toBe(4);
    // 마지막 조각(주문 읽기 — 클릭 · 읽기)을 «읽기»부터 한 번 더 나눈다
    await tile("주문 읽기").hover();
    await tile("주문 읽기").getByRole("button", { name: "설정 열기" }).click();
    await page.locator(".action .summary").nth(1).click();
    await page.getByRole("button", { name: "여기서 나누기" }).click();
    await expect.poll(count).toBe(5);
    await page.locator(".topbar").getByRole("button", { name: "저장", exact: true }).click();
    await expect.poll(async () => (await saved()).nodes.length).toBe(5);
    const f = await saved();
    expect(f.nodes.find((n) => n.id === "w")!.type === "web" && (f.nodes.find((n) => n.id === "w") as { config: { actions: { id: string }[] } }).config.actions.map((a) => a.id)).toEqual(["r1"]);
    // 저장 노드의 {{ $input.orders }}가 그대로 맞는다
    expect(checkFlow(f)).toEqual([]);
  });

  it("★노드 고르기의 «사람 기다리기» — 사람 기다리기 하나만 든 웹페이지 노드(앞 페이지에서 이어서)", async () => {
    await page.getByRole("button", { name: "노드 더하기 (Tab)" }).click();
    await page.getByPlaceholder(/무엇을 할까요/).fill("로그인");
    await page.locator(".picker-item", { hasText: "사람 기다리기" }).click();
    await expect.poll(() => page.locator(".relay-node.t-human").count()).toBe(2);
  });
});
