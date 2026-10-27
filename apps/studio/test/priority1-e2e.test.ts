/**
 * 1순위 화면 e2e(2026-10-18) — 캔버스 메모 · 노드 출력 고정 · 실행 시간표 · 실행 폼(입력의 종류) · 같은 입력으로 다시 실행.
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
const shots = process.env["FLOWSMITH_SHOTS"];
let app: App;
let browser: Browser;
let page: Page;
let dir: string;
const pills = () => page.locator(".topbar").innerText();
const api = (method: string, path: string, body?: unknown) => fetch(`${app.url}${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).then((r) => r.json() as Promise<any>);

const pos = (x: number) => ({ x, y: 0 });
const calc = {
  schemaVersion: 1, id: "calc", name: "계산 워크플로우", description: "수를 받아 하나 더합니다",
  params: [
    { name: "n", label: "수", type: "number", default: "1", help: "더할 수" },
    { name: "item", label: "품목", type: "select", options: ["연필", "공책"], required: false },
    { name: "day", label: "기준일", type: "date", required: false },
  ],
  nodes: [
    { id: "a", type: "custom", name: "앞", position: pos(0), config: { code: "return { n: Number(ctx.params.n) };", outputs: ["n"] } },
    { id: "b", type: "custom", name: "뒤", position: pos(260), config: { code: "return { m: input.n + 1 };", outputs: ["m"] } },
  ],
  edges: [{ id: "e1", from: { node: "a", port: "out" }, to: { node: "b" } }],
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-p1-ui-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), staticDir: join(dir, "dist"), monitor: false, schedule: false, retention: false });
  await api("POST", "/api/flows", { draft: calc });
  await api("POST", "/api/flows/calc/versions", { note: "" });
  await api("POST", "/api/flows/calc/deploy", { version: 1 });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("1순위 화면", () => {
  it("★캔버스 메모 — 더하고 · 적고 · 저장하면 초안에 남는다", async () => {
    await page.goto(`${app.url}/#/flows/calc`);
    await page.locator(".relay-node").first().waitFor();
    await page.getByTitle(/메모 더하기/).click();
    const note = page.locator(".canvas-note");
    await note.waitFor();
    // ★노드와 겹치지 않는 자리에 뜬다
    const nb = (await note.boundingBox())!;
    for (const tile of await page.locator(".relay-node").all()) {
      const t = (await tile.boundingBox())!;
      expect(nb.x < t.x + t.width && t.x < nb.x + nb.width && nb.y < t.y + t.height && t.y < nb.y + nb.height).toBe(false);
    }
    await note.locator("textarea").fill("앞은 입력을 숫자로, ");
    // ★한글 입력기처럼 조합하며 친다 — «ㅎ → 하 → 한»이 «ㅎㅏㄴ»으로 흩어지지 않아야 한다(한 글자마다 초안을 바꿔 조합이 끊기던 버그)
    const cdp = await page.context().newCDPSession(page);
    for (const syllable of [["ㄷ", "뒤"], ["ㄴ", "느"], ["ㅎ", "하", "핫"], ["ㄴ", "나"], ["ㄷ", "더"], ["ㅎ", "하", "한"], ["ㄷ", "다"]]) {
      for (const step of syllable) await cdp.send("Input.imeSetComposition", { text: step, selectionStart: step.length, selectionEnd: step.length });
      await cdp.send("Input.insertText", { text: syllable[syllable.length - 1]! });
    }
    await expect.poll(() => note.locator("textarea").inputValue()).toBe("앞은 입력을 숫자로, 뒤느핫나더한다");
    await page.keyboard.press("Control+s");
    await expect.poll(pills).toContain("저장됨");
    const d = await api("GET", "/api/flows/calc");
    expect(d.draft.notes).toEqual([expect.objectContaining({ text: "앞은 입력을 숫자로, 뒤느핫나더한다", color: "yellow" })]);
  }, 60_000);

  it("★실행하면 시간표 · 노드 출력을 고정하면 타일에 📌 — 초안 시험에서 그 노드는 돌지 않는다", async () => {
    await page.locator(".run-btn").click();
    await page.locator(".logpanel-head .dot.ok").waitFor({ timeout: 20_000 });
    if (await page.locator(".logpanel-body").count() === 0) await page.locator(".logpanel-head").click();   // 실행하면 저절로 펴질 수 있다
    await page.locator(".timeline .tl-row").first().waitFor();
    expect(await page.locator(".timeline .tl-row").count()).toBe(2);
    if (shots) await page.screenshot({ path: join(shots, "p1-timeline.png") });

    await page.locator(".relay-node", { hasText: "앞" }).click();
    await page.getByRole("button", { name: /이 출력 고정/ }).click();
    await page.locator(".pin-banner").waitFor();
    expect((await api("GET", "/api/flows/calc")).pins).toEqual({ a: { n: 1 } });
    if (shots) await page.screenshot({ path: join(shots, "p1-pin.png") });
    await page.keyboard.press("Escape");
    await page.locator(".relay-node", { hasText: "앞" }).locator(".tile-pin").waitFor();
  }, 60_000);

  it("★실행 폼 — 종류마다 칸 · 틀리면 까닭 · 게시된 버전을 돌려 결과를 보인다", async () => {
    await page.goto(`${app.url}/#/run/calc`);
    await page.getByRole("heading", { name: "계산 워크플로우" }).waitFor();
    const num = page.locator(".field", { hasText: "수" }).first().locator("input");
    expect(await num.getAttribute("placeholder")).toBe("비우면 1");
    await num.fill("열");
    await page.locator(".field-bad", { hasText: "숫자가 아닙니다" }).waitFor();
    expect(await page.getByRole("button", { name: "실행" }).isDisabled()).toBe(true);
    await num.fill("41");
    await page.locator(".field", { hasText: "품목" }).locator("select").selectOption("공책");
    expect(await page.locator(".field", { hasText: "기준일" }).locator("input").getAttribute("type")).toBe("date");
    if (shots) await page.screenshot({ path: join(shots, "p1-form.png") });
    await page.getByRole("button", { name: "실행" }).click();
    await expect.poll(() => page.locator(".run-form").innerText(), { timeout: 20_000 }).toContain("성공");
    expect(await page.locator(".run-form").innerText()).toContain("42");   // 게시된 버전 — 고정된 출력을 쓰지 않는다
    if (shots) await page.screenshot({ path: join(shots, "p1-form-done.png") });
  }, 60_000);

  it("★실행 기록 — 같은 입력으로 다시 실행", async () => {
    const before = (await api("GET", "/api/flows/calc/runs")).length;
    await page.goto(`${app.url}/#/flows/calc`);
    await page.getByRole("button", { name: "실행 기록" }).click();
    // 다시 실행은 실행 머리에 — 어느 단계를 골라 두었든
    await page.locator(".exec-actions").getByRole("button", { name: "↻ 다시 실행", exact: true }).click();
    await expect.poll(async () => (await api("GET", "/api/flows/calc/runs")).length, { timeout: 15_000 }).toBe(before + 1);
    const runs = await api("GET", "/api/flows/calc/runs");
    expect(runs[0].params).toEqual(runs[1].params);
    // 새 실행이 바로 열린다
    await expect.poll(() => page.url()).toContain(`/runs/${runs[0].id}`);
  }, 60_000);

  it("★여기서부터 다시 — 실패한 단계를 고치고 그 단계부터 · 앞 단계는 그 실행의 출력(무엇을 그대로 쓰는지 먼저 보인다) · 위의 «실행»은 실행 기록에서도", async () => {
    const node = (id: string, name: string, code: string) => ({ id, type: "custom", name, position: pos(0), config: { code, outputs: ["n"] } });
    const pipe = (last: string) => ({ schemaVersion: 1, id: "pipe", name: "줄", nodes: [node("a", "앞", "return { n: Math.random() };"), node("b", "가운데", "return { n: input.n };"), node("c", "끝", last)],
      edges: [{ id: "e1", from: { node: "a", port: "out" }, to: { node: "b" } }, { id: "e2", from: { node: "b", port: "out" }, to: { node: "c" } }] });
    await api("POST", "/api/flows", { draft: pipe("throw new Error('아직');") });
    const first = (await api("POST", "/api/flows/pipe/runs", { version: "draft" })).runId as string;
    await expect.poll(async () => (await api("GET", `/api/runs/${first}`)).status, { timeout: 15_000 }).toBe("failure");
    await api("PUT", "/api/flows/pipe/draft", { draft: pipe("return { n: input.n };") });

    await page.goto(`${app.url}/#/flows/pipe/runs/${first}`);
    await page.locator(".exec-actions").getByRole("button", { name: "↻ «끝»부터 다시" }).click();
    const confirm = page.getByRole("dialog", { name: "여기서부터 다시" });
    await expect.poll(() => confirm.innerText()).toContain("이 실행의 출력을 그대로 씀 — 앞 · 가운데");
    await confirm.getByRole("button", { name: "다시 실행" }).click();
    await expect.poll(async () => (await api("GET", "/api/flows/pipe/runs"))[0].status, { timeout: 15_000 }).toBe("success");
    const [again] = await api("GET", "/api/flows/pipe/runs");
    expect(again.resumedFrom).toMatchObject({ runId: first, nodeId: "c" });
    const was = (await api("GET", `/api/runs/${first}`)).result.nodes.find((n: { id: string }) => n.id === "a").output;
    expect((await api("GET", `/api/runs/${again.id}`)).result.output).toEqual(was);
    await expect.poll(() => page.locator(".exec-item.on").innerText()).toContain("«끝»부터");

    // 위 막대의 «실행» — 실행 기록 탭에서도. 새 실행을 바로 연다
    const before = (await api("GET", "/api/flows/pipe/runs")).length;
    await page.locator(".topbar").getByRole("button", { name: "실행", exact: true }).click();
    await expect.poll(async () => (await api("GET", "/api/flows/pipe/runs")).length, { timeout: 15_000 }).toBe(before + 1);
    const latest = (await api("GET", "/api/flows/pipe/runs"))[0].id as string;
    await expect.poll(() => page.url()).toContain(`/runs/${latest}`);
  }, 60_000);
});
