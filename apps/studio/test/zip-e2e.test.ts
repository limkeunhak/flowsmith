/**
 * 압축(zip) 노드 e2e(PLAN §52) — 노드 고르기에서 «압축(zip)»을 놓고, 서버에서 돌려 만든 zip을 내려받기 주소로 받는다.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const pageErrors: string[] = [];
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${app.url}/api${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-zip-ui-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker({ filesDir: join(dir, "files") }), staticDir: join(dir, "dist"), filesDir: join(dir, "files"), monitor: false, schedule: false, retention: false });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  // ★API로 넣은 초안(빈 칸이 있는 것)을 열어도 화면이 죽지 않아야 한다 — 설정의 기본값 채우기(normalize)
  page.on("pageerror", (e) => { pageErrors.push(e.message); });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("압축(zip) 노드", () => {
  it("★서버에서 돌려 zip을 만들고 내려받기 주소로 받는다", async () => {
    const draft = { schemaVersion: 1, id: "zipper", name: "zipper", nodes: [{ id: "z", type: "zip", name: "묶기", position: { x: 0, y: 0 }, config: { from: { dir: "pdf" }, to: { name: "묶음" } } }], edges: [] };
    expect((await call("POST", "/flows", { draft, team: null })).status).toBe(201);
    // 이 워크플로우의 폴더(서버가 붙인 uuid)에 PDF 둘
    const at = (await call("GET", "/files?flow=zipper&scope=flow&dir=")).body as { root: string; dir: string };
    mkdirSync(join(at.root, at.dir, "pdf", "하위"), { recursive: true });
    writeFileSync(join(at.root, at.dir, "pdf", "가.pdf"), "%PDF-1.4 가");
    writeFileSync(join(at.root, at.dir, "pdf", "하위", "나.pdf"), "%PDF-1.4 나");
    const v = (await call("POST", "/flows/zipper/versions", { note: "zip" })).body as { version: number };
    await call("POST", "/flows/zipper/deploy", { version: v.version });
    const { runId } = (await call("POST", "/flows/zipper/runs", { params: {} })).body as { runId: string };
    let run: { status: string; result?: { output?: { file: string; count: number } } } = { status: "running" };
    for (let i = 0; i < 50 && (run.status === "running" || run.status === "queued"); i++) { await new Promise((r) => setTimeout(r, 200)); run = (await call("GET", `/runs/${runId}`)).body; }
    expect(run.status).toBe("success");
    expect(run.result!.output).toMatchObject({ count: 2, file: expect.stringMatching(/묶음\.zip$/) });
    const res = await fetch(`${app.url}/api/files/download?path=${encodeURIComponent(run.result!.output!.file)}`);
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(buf.includes(Buffer.from("하위/나.pdf"))).toBe(true);
  }, 30_000);

  it("노드 고르기의 «압축(zip)» — 타일 설명 · 설정에 만든 zip 목록", async () => {
    await page.goto(`${app.url}/#/flows/zipper`);
    await page.locator(".react-flow__node").first().waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: "다음 단계 더하기" }).first().click({ timeout: 5000 });
    await page.locator(".picker-item").filter({ hasText: "압축(zip)" }).first().click({ timeout: 5000 });
    const tile = page.locator(".react-flow__node").filter({ has: page.locator('.tile-name:text-is("압축(zip) 1")') });
    await tile.waitFor({ timeout: 5000 });
    expect(await tile.locator(".tile-sub").innerText()).toBe("폴더 전체 → 묶음.zip");
    // 놓으면 그 설정이 열린다 — 같은 폴더(이 워크플로우 폴더)의 zip이 보이고 내려받기 단추가 있다
    await page.getByText("만든 zip").waitFor({ timeout: 5000 });
    await page.getByText("묶음.zip").first().waitFor({ timeout: 5000 });
    expect(await page.getByTitle("내려받기").count()).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  }, 30_000);
});
