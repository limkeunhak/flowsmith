/**
 * 캔버스 끌어 잇기 e2e(2026-10-27) — 이어지지 않은 출력 점에서 끌어 이을 수 있어야 한다.
 * ★«다음 단계 더하기(+)»의 짧은 선이 출력 점 위를 덮어 끌기가 시작되지 않았다(사용자 보고: 선을 끊고 사이에 새 노드를 넣으려니 안 된다)
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

const node = (id: string, x: number) => ({ id, type: "custom", name: `노드 ${id}`, position: { x, y: 0 }, config: { code: "return {};", outputs: [], usesPage: false } });
const make = (id: string, edges: unknown[]) => fetch(`${app.url}/api/flows`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ draft: { schemaVersion: 1, id, name: id, nodes: [node("a", 0), node("b", 600)], edges }, team: null }),
});
const edges = () => page.locator(".react-flow__edge").count();
/** 새 탭에서 연다 — 앞 시험의 «저장 안 됨»이 이동을 막지 않게 */
async function open(id: string): Promise<void> {
  await page?.close();
  page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.goto(`${app.url}/#/flows/${id}`);
  await page.locator(".react-flow__node").first().waitFor();
}
const tile = (name: string) => page.locator(".react-flow__node").filter({ has: page.locator(`.tile-name:text-is("${name}")`) });

/** 출력 점 → 입력 점으로 마우스로 끈다 — off: 점 가운데에서 비켜 잡기 · miss: 입력 점에서 비켜 놓기 */
async function drag(from: string, to: string, off = 0, miss = 0): Promise<void> {
  const src = (await tile(from).locator(".react-flow__handle.source").first().boundingBox())!;
  const dst = (await tile(to).locator(".react-flow__handle.target").boundingBox())!;
  // ★그 자리 맨 위가 출력 점이어야 한다(덮는 것이 있으면 끌기가 시작되지 않는다)
  // (브라우저에서 돈다 — 이 시험의 tsconfig에는 DOM 형이 없어 globalThis로)
  const top = await page.evaluate(([x, y]) => (globalThis as unknown as { document: { elementFromPoint(x: number, y: number): { className: string } | null } }).document.elementFromPoint(x!, y!)?.className ?? "", [src.x + src.width / 2, src.y + src.height / 2]);
  expect(String(top)).toContain("react-flow__handle");
  await page.mouse.move(src.x + src.width / 2 + off, src.y + src.height / 2 + off);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) await page.mouse.move(src.x + (dst.x - src.x) * i / 15, src.y + (dst.y - src.y) * i / 15);
  await page.mouse.move(dst.x + dst.width / 2 - miss, dst.y + dst.height / 2 + miss);
  await page.mouse.up();
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-connect-ui-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), staticDir: join(dir, "dist"), monitor: false, schedule: false, retention: false });
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("캔버스 — 끌어 잇기", () => {
  it("★이어지지 않은 출력 점에서 끌어 잇는다(«+»가 점을 덮지 않는다)", async () => {
    await make("plain", []);
    await open("plain");
    expect(await edges()).toBe(0);
    await drag("노드 a", "노드 b");
    await expect.poll(edges).toBe(1);
  }, 30_000);

  it("점을 조금 비켜 잡아도 · 입력 점 가까이 놓아도 이어진다(10px 점은 잡기 빡빡하다)", async () => {
    await make("loose", []);
    await open("loose");
    expect(await edges()).toBe(0);
    await drag("노드 a", "노드 b", 11, 20);
    await expect.poll(edges).toBe(1);
  }, 30_000);

  it("★선을 끊고 «+»로 새 노드를 붙인 뒤, 새 노드를 뒤 노드에 끌어 잇는다", async () => {
    await make("between", [{ id: "e1", from: { node: "a", port: "out" }, to: { node: "b" } }]);
    await open("between");
    await page.locator(".react-flow__edge").first().waitFor();
    const box = (await page.locator(".react-flow__edge").first().boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByRole("button", { name: "연결 끊기" }).click();
    await expect.poll(edges).toBe(0);
    // A의 «+» 단추는 그대로 눌린다 — 새 노드가 A 뒤에 붙는다
    await tile("노드 a").getByRole("button", { name: "다음 단계 더하기" }).click();
    await page.locator(".picker-item").filter({ hasText: "커스텀" }).first().click();
    await expect.poll(edges).toBe(1);
    await page.keyboard.press("Escape");
    await drag("커스텀 1", "노드 b");
    await expect.poll(edges).toBe(2);
  }, 30_000);
});
