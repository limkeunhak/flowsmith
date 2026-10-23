/**
 * 노드 지우기 e2e(2026-10-20) — 사용자 «노드 삭제 버튼을 찾기 힘들었다».
 * 노드에 올리면 위에 도구 막대(🗑) · 오른쪽 클릭 메뉴 · 노드 창의 «지우기» — 지우면 «되돌리기» 알림(노드와 선이 돌아온다).
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

const node = (id: string, name: string, x: number) => ({ id, type: "custom", name, position: { x, y: 0 }, config: { code: "return {};", outputs: [] } });
const draft = {
  schemaVersion: 1, id: "del", name: "지우기 시험",
  nodes: [node("a", "하나", 0), node("b", "둘", 260), node("c", "셋", 520)],
  edges: [{ id: "e1", from: { node: "a", port: "out" }, to: { node: "b" } }, { id: "e2", from: { node: "b", port: "out" }, to: { node: "c" } }],
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-node-del-"));
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
const edges = () => page.locator(".react-flow__edge").count();

describe("노드 지우기 — 찾기 쉽게", () => {
  it("★올리면 위에 🗑 → 지우면 «되돌리기» — 노드와 선이 돌아온다", async () => {
    await page.goto(`${app.url}/#/flows/del`);
    await tile("둘").waitFor();
    expect(await count()).toBe(3);
    expect(await tile("둘").getByRole("button", { name: "노드 지우기" }).isVisible()).toBe(false);   // 평소에는 숨어 있다
    await tile("둘").hover();
    await tile("둘").getByRole("button", { name: "노드 지우기" }).click();
    await expect.poll(count).toBe(2);
    await expect.poll(edges).toBe(0);
    const toast = page.getByRole("status");
    await toast.getByText("«둘» 노드를 지웠습니다").waitFor();
    await toast.getByRole("button", { name: "되돌리기" }).click();
    await expect.poll(count).toBe(3);
    await expect.poll(edges).toBe(2);
  });

  it("오른쪽 클릭 메뉴 · 노드 창의 «지우기» — 저장하면 서버에도", async () => {
    await tile("셋").click({ button: "right" });
    await page.getByRole("menuitem", { name: "노드 지우기" }).click();
    await expect.poll(count).toBe(2);
    await page.getByRole("status").getByText("«셋» 노드를 지웠습니다").waitFor();

    await tile("둘").hover();
    await tile("둘").getByRole("button", { name: "설정 열기" }).click();
    await page.getByRole("button", { name: /^지우기$/ }).click();
    await expect.poll(count).toBe(1);
    await page.getByRole("status").getByText("«둘» 노드를 지웠습니다").waitFor();

    await page.getByRole("button", { name: "저장" }).click();
    await expect.poll(async () => ((await (await fetch(`${app.url}/api/flows/del`)).json()) as { draft: { nodes: unknown[] } }).draft.nodes.length).toBe(1);
  });
});
