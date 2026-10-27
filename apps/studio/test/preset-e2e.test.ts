/**
 * 노드 고르기의 «화면 캡처» · «HTML 추출» e2e(2026-10-27) — 바로가기를 고르면 저장 동작 하나짜리 웹페이지 노드가
 * 그 얼굴(이름 · 저장할 곳)로 놓이고, 설정을 열면 캡처 · HTML 칸이 보인다.
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
  dir = mkdtempSync(join(tmpdir(), "flowsmith-preset-ui-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), staticDir: join(dir, "dist"), monitor: false, schedule: false, retention: false });
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("노드 고르기 — 화면 캡처 · HTML 추출", () => {
  for (const [title, sub, row, field] of [["화면 캡처", "📷 capture/화면.png", "전체 페이지를 PNG로 찍어", "가릴 요소 더하기"], ["HTML 추출", "🧾 html/페이지.html", "페이지 HTML을 뽑아", "무엇의 HTML"]] as const) {
    it(`★«${title}»를 고르면 그 얼굴의 노드가 놓이고 설정에 그 칸이 있다`, async () => {
      const id = title === "화면 캡처" ? "cap" : "htm";
      await make(id, []);
      await open(id);
      await tile("노드 a").getByRole("button", { name: "다음 단계 더하기" }).click();
      await page.locator(".picker-item").filter({ hasText: title }).first().click();
      const n = tile(title);
      await n.waitFor();
      expect(await n.locator(".tile-sub").innerText()).toBe(sub);
      expect(await edges()).toBe(1);
      // 만들면 설정이 열린다 — 동작 줄을 펼치면 그 칸
      await page.getByText(row).first().click();
      await page.getByText(field).first().waitFor({ timeout: 5000 });
    }, 30_000);
  }
});
