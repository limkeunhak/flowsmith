/**
 * 녹화 — 앞 단계에서 읽은 값 e2e(2026-10-18): 읽기 → 쓰기 플로우의 «쓰기» 노드를 녹화하면 앞 단계 값이 위에 보이고,
 * [넣기]로 넣은 입력은 `{{ $input.이름 }}`으로 저절로 이어진다(«글자 그대로»로 되돌린다).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { startTestSite, type TestSite } from "@flowsmith/testsite";
import { generateKey, InProcessWorker, SecretBox, startApp, type App } from "@flowsmith/server";

const root = fileURLToPath(new URL("..", import.meta.url));
const shots = process.env["FLOWSMITH_SHOTS"];
let site: TestSite;
let app: App;
let browser: Browser;
let page: Page;
let dir: string;

async function spot(width: number, height: number, path: string, selector: string): Promise<{ x: number; y: number }> {
  const ref = await browser.newPage({ viewport: { width, height } });
  await ref.goto(`${site.url}${path}`);
  const b = (await ref.locator(selector).boundingBox())!;
  await ref.close();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-link-ui-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  site = await startTestSite(0);
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), staticDir: join(dir, "dist"), monitor: false, schedule: false, retention: false });
  const draft = {
    schemaVersion: 1, id: "copy", name: "읽어서 쓰기", settings: { defaultTimeoutMs: 5000 },
    nodes: [
      { id: "r", type: "custom", name: "주문 읽기", position: { x: 0, y: 0 }, config: { code: "return { userId: 'kim-7731', count: 3 };", outputs: ["userId", "count"] } },
      { id: "w", type: "web", name: "주문 넣기", position: { x: 300, y: 0 }, config: { start: { kind: "url", url: `${site.url}/login` }, actions: [] } },
    ],
    edges: [{ id: "e1", from: { node: "r", port: "out" }, to: { node: "w" } }],
  };
  await fetch(`${app.url}/api/flows`, { method: "POST", body: JSON.stringify({ draft }) });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await app?.close();
  await site?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("녹화 — 앞 단계에서 읽은 값", () => {
  it("★★위에 보이고 · [넣기]로 넣은 입력은 앞 단계 값에 저절로 이어진다 · 녹화 끝이면 노드에 표현식으로", async () => {
    await page.goto(`${app.url}/#/flows/copy`);
    await page.locator(".relay-node", { hasText: "주문 넣기" }).click();
    await page.getByRole("button", { name: /녹화로 동작 더하기/ }).click();
    await page.getByRole("button", { name: "● 녹화 시작" }).click();
    await page.locator(".recorder .live-stage canvas").waitFor({ timeout: 30_000 });
    await page.locator(".recorder .live-modal").waitFor({ state: "detached", timeout: 60_000 });
    const up = page.locator(".rec-upstream");
    await up.waitFor({ timeout: 15_000 });
    expect(await up.innerText()).toMatch(/앞 단계에서 읽은 값 2개[\s\S]*주문 읽기 › userId[\s\S]*kim-7731[\s\S]*주문 읽기 › count[\s\S]*3/);

    const canvas = page.locator(".live-stage canvas");
    const vw = Number(await canvas.getAttribute("width"));
    const vh = Number(await canvas.getAttribute("height"));
    const box = (await canvas.boundingBox())!;
    const s = box.width / vw;
    const at = (p: { x: number; y: number }) => page.mouse.click(box.x + p.x * s, box.y + p.y * s);

    // 녹화 모드에서 아이디 칸을 누르고 [넣기] → 다른 곳을 눌러 입력을 마친다
    await page.locator(".rec-modes").getByRole("button", { name: "● 녹화" }).click();
    await at(await spot(vw, vh, "/login", "#uid"));
    await up.locator(".rec-upstream-row", { hasText: "userId" }).getByRole("button", { name: "넣기" }).click();
    await at(await spot(vw, vh, "/login", "#pw"));
    const linked = page.locator(".rec-item", { has: page.locator(".rec-linked") });
    await linked.waitFor({ timeout: 15_000 });
    expect(await linked.locator(".rec-linked").innerText()).toContain("주문 읽기 › userId");
    expect(await linked.locator(".rec-linked").innerText()).toContain("«kim-7731» 대신");
    if (shots) await page.screenshot({ path: join(shots, "link-record.png") });

    await page.getByRole("button", { name: /녹화 끝/ }).click();
    await page.locator(".drawer").waitFor();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+s");
    await expect.poll(async () => {
      const d = (await (await fetch(`${app.url}/api/flows/copy`)).json() as { draft: { nodes: { id: string; config: { actions?: { kind: string; value?: string }[] } }[] } }).draft;
      return d.nodes.find((n) => n.id === "w")!.config.actions!.filter((a) => a.kind === "fill").map((a) => a.value);
    }, { timeout: 10_000 }).toEqual(["{{ $input.userId }}"]);
  }, 120_000);
});
