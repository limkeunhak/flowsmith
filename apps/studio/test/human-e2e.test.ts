/**
 * 사람 기다리기 화면 e2e — 녹화(로그인 화면의 표시 고르기 → 직접 로그인 → 끝 표시) · 실행하면 실제 화면이 저절로 열리고
 * 그 화면에서 로그인하면 실행이 이어 간다. ★넣은 비밀번호는 녹화 · 초안 · 화면 어디에도 남지 않는다.
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

const tile = (name: string) => page.locator(".relay-node", { hasText: name });
const pills = () => page.locator(".topbar").innerText();

/** 같은 크기의 참조 페이지에서 요소의 가운데를 잰다 */
async function spot(width: number, height: number, path: string, selector: string, login = false): Promise<{ x: number; y: number }> {
  const ref = await browser.newPage({ viewport: { width, height } });
  if (login) { await ref.goto(`${site.url}/login`); await ref.fill("#uid", "kim"); await ref.fill("#pw", "p@ss"); await ref.click("button"); }
  await ref.goto(`${site.url}${path}`);
  const b = (await ref.locator(selector).boundingBox())!;
  await ref.close();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-human-ui-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  site = await startTestSite(0);
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), staticDir: join(dir, "dist"), monitor: false, schedule: false, retention: false });
  const draft = {
    schemaVersion: 1, id: "portal", name: "포털 로그인", settings: { defaultTimeoutMs: 5000 },
    nodes: [{ id: "w", type: "web", name: "포털", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: `${site.url}/home` }, actions: [] } }],
    edges: [],
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

describe("사람 기다리기 화면", () => {
  it("★★녹화 — 로그인 화면의 표시를 고르고 · 직접 로그인하고(녹화 안 됨) · «사라지면»으로 끝낸다", async () => {
    await page.goto(`${app.url}/#/flows/portal`);
    await tile("포털").click();
    await page.getByRole("button", { name: /녹화로 동작 더하기/ }).click();
    await page.getByRole("button", { name: "● 녹화 시작" }).click();
    await page.locator(".recorder .live-stage canvas").waitFor({ timeout: 30_000 });
    await page.locator(".recorder .live-modal").waitFor({ state: "detached", timeout: 60_000 });
    const canvas = page.locator(".live-stage canvas");
    const vw = Number(await canvas.getAttribute("width"));
    const vh = Number(await canvas.getAttribute("height"));
    const box = (await canvas.boundingBox())!;
    const s = box.width / vw;
    const at = (p: { x: number; y: number }) => page.mouse.click(box.x + p.x * s, box.y + p.y * s);

    // 1. 로그인 화면의 표시 — 「로그인」 단추(읽기 모드라 페이지에 가지 않는다)
    await page.getByRole("button", { name: /사람 기다리기/ }).click();
    await page.locator(".rec-human", { hasText: "로그인 화면의 표시를 고르세요" }).waitFor();
    await at(await spot(vw, vh, "/login", "button"));
    await page.locator(".rec-human", { hasText: "이제 직접 로그인하세요" }).waitFor({ timeout: 15_000 });

    // 2. 직접 로그인 — 둘러보기 모드라 녹화되지 않는다
    await at(await spot(vw, vh, "/login", "#uid"));
    await page.keyboard.type("kim");
    await at(await spot(vw, vh, "/login", "#pw"));
    await page.keyboard.type("p@ss");
    await at(await spot(vw, vh, "/login", "button"));
    await page.waitForTimeout(1500);
    expect(await page.locator(".rec-item").count()).toBe(0);
    if (shots) await page.screenshot({ path: join(shots, "human-record.png") });

    // 3. 끝 — 로그인 단추가 사라지면
    await page.getByRole("button", { name: /로그인 끝 — .*사라지면/ }).click();
    await page.locator(".rec-item").first().waitFor();
    expect(await page.locator(".rec-item").first().innerText()).toMatch(/보일 때만 사람을 기다립니다 — «로그인해 주세요» · .*사라지면 이어 갑니다/);
    await page.locator(".rec-item input").first().fill("시험 사이트에 로그인해 주세요");
    // ★사람 기다리기는 따로 노드로(기본 켬 · 2026-10-22) — 접속만 하는 노드 → 사람 기다리기 노드
    await page.locator(".rec-cut").first().waitFor();
    await page.getByRole("button", { name: /녹화 끝 — 동작 1개 넣기 · 노드 2개로/ }).click();
    await expect.poll(() => page.locator(".relay-node").count()).toBe(2);
    await tile("페이지 접속").waitFor();
    expect(await page.locator(".relay-node.t-human").innerText()).toContain("사람 기다리기");
    await page.keyboard.press("Control+s");
    await expect.poll(pills).toContain("저장됨");
    const draft = (await (await fetch(`${app.url}/api/flows/portal`)).json() as { draft: { nodes: { id: string; config: { start: { kind: string }; actions: unknown[] } }[] } }).draft;
    const w = draft.nodes.find((n) => n.id === "w")!;   // 원래 id는 마지막 조각(사람 기다리기)
    expect(w.config.start.kind).toBe("continue");
    expect(w.config.actions).toEqual([expect.objectContaining({ kind: "human", prompt: "시험 사이트에 로그인해 주세요", done: expect.objectContaining({ kind: "hidden" }), appears: expect.objectContaining({ label: expect.any(String) }) })]);
    expect(draft.nodes.find((n) => n.id !== "w")!.config).toMatchObject({ start: { kind: "url" }, actions: [] });
    expect(JSON.stringify(draft)).not.toContain("p@ss");
  }, 120_000);

  it("★★실행 — 사람을 기다리면 실제 화면이 저절로 열리고, 그 화면에서 로그인하면 이어 간다", async () => {
    await page.locator(".run-btn").click();
    // 서버 브라우저 — 실제 화면이 저절로 열리고 이 동안은 누를 수 있다
    await page.locator(".screen-human", { hasText: "시험 사이트에 로그인해 주세요" }).waitFor({ timeout: 20_000 });
    await page.locator(".screen-stage.control img").waitFor({ timeout: 10_000 });
    expect(await page.locator(".logpanel-head").innerText()).toContain("사람을 기다리는 중");
    const img = page.locator(".screen-stage img");
    const nat = await img.evaluate((el) => { const i = el as unknown as { naturalWidth: number; naturalHeight: number }; return { w: i.naturalWidth, h: i.naturalHeight }; });
    const box = (await img.boundingBox())!;
    const at = (p: { x: number; y: number }) => page.mouse.click(box.x + (p.x / nat.w) * box.width, box.y + (p.y / nat.h) * box.height);
    if (shots) await page.screenshot({ path: join(shots, "human-run.png") });

    await at(await spot(nat.w, nat.h, "/login", "#uid"));
    await page.keyboard.type("kim");
    await at(await spot(nat.w, nat.h, "/login", "#pw"));
    await page.keyboard.type("p@ss");
    await at(await spot(nat.w, nat.h, "/login", "button"));

    // 이어 간다 — 끝나면 화면이 끝났다고 알리고 로그가 성공
    await page.locator(".screen-ended", { hasText: "실행이 끝났습니다" }).waitFor({ timeout: 20_000 });
    await page.locator(".screen-head").getByTitle(/닫기/).click();
    await page.locator(".logpanel-head .dot.ok").waitFor({ timeout: 10_000 });
    expect(await page.content()).not.toContain("p@ss");
  }, 120_000);

  it("★다시 녹화 — 앞 동작을 재생하다 사람 기다리기에 오면 라이브 화면에서 로그인하고, 재생이 이어 간다", async () => {
    await page.keyboard.press("Escape");
    await page.locator(".relay-node.t-human").click();
    await page.getByRole("button", { name: /녹화로 동작 더하기/ }).click();
    await page.getByRole("button", { name: "● 녹화 시작" }).click();   // 앞 노드(페이지 접속) 재생 · «이 노드의 동작 1개를 먼저 재생»이 켜져 있다
    await page.locator(".live-human", { hasText: "시험 사이트에 로그인해 주세요" }).waitFor({ timeout: 30_000 });
    expect(await page.locator(".recorder .live-modal").count()).toBe(0);   // 재생 중이어도 덮개 없이 화면을 만진다
    const canvas = page.locator(".live-stage canvas");
    const vw = Number(await canvas.getAttribute("width"));
    const vh = Number(await canvas.getAttribute("height"));
    const box = (await canvas.boundingBox())!;
    const s = box.width / vw;
    const at = (p: { x: number; y: number }) => page.mouse.click(box.x + p.x * s, box.y + p.y * s);
    await at(await spot(vw, vh, "/login", "#uid"));
    await page.keyboard.type("kim");
    await at(await spot(vw, vh, "/login", "#pw"));
    await page.keyboard.type("p@ss");
    await at(await spot(vw, vh, "/login", "button"));
    await page.locator(".live-human").waitFor({ state: "detached", timeout: 20_000 });
    await expect.poll(() => page.locator(".rec-modes .seg-tabs button.on").innerText(), { timeout: 20_000 }).toContain("녹화");
    expect(await page.locator(".rec-item").count()).toBe(0);   // 재생 중의 로그인은 녹화되지 않았다
    await page.locator(".rec-foot").getByRole("button", { name: "그만두기" }).click();
  }, 120_000);
});
