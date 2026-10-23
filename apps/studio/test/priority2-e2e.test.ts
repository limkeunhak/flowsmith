/**
 * 2순위 화면 e2e(2026-10-18) — 버전 비교 · 승인 기다리기(설정 · 띠 · 대시보드) · 다른 플로우가 끝나면 · 파일이 생기면 · 팀 공용 값.
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
const api = (method: string, path: string, body?: unknown) => fetch(`${app.url}${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).then((r) => r.status === 204 ? null : r.json() as Promise<any>);

const pos = (x: number) => ({ x, y: 0 });
const custom = (id: string, name: string, x: number, code: string, outputs: string[]) => ({ id, type: "custom", name, position: pos(x), config: { code, outputs } });
const calc = {
  schemaVersion: 1, id: "calc", name: "주문 읽기",
  params: [{ name: "n", label: "수", type: "number", default: "1" }],
  nodes: [custom("a", "앞", 0, "return { n: Number(ctx.params.n) };", ["n"]), custom("b", "뒤", 260, "return { m: input.n + 1 };", ["m"])],
  edges: [{ id: "e1", from: { node: "a", port: "out" }, to: { node: "b" } }],
};
const gated = {
  schemaVersion: 1, id: "gated", name: "주문 넣기",
  nodes: [
    custom("a", "앞", 0, "return { n: 7 };", ["n"]),
    { id: "ok", type: "approval", name: "결재", position: pos(260), config: { message: "{{ $input.n }}건을 제출할까요?", minRole: "runner", timeoutMin: 30 } },
    custom("b", "제출", 520, "return { done: input.n, by: input.by };", ["done", "by"]),
  ],
  edges: [{ id: "e1", from: { node: "a", port: "out" }, to: { node: "ok" } }, { id: "e2", from: { node: "ok", port: "out" }, to: { node: "b" } }],
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-p2-ui-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), staticDir: join(dir, "dist"), monitor: false, schedule: false, retention: false });
  for (const f of [calc, gated]) {
    await api("POST", "/api/flows", { draft: f });
    await api("POST", `/api/flows/${f.id}/versions`, { note: "처음" });
    await api("POST", `/api/flows/${f.id}/deploy`, { version: 1 });
  }
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("2순위 화면", () => {
  it("★버전 비교 — 게시된 버전 → 초안의 바뀐 것을 사람 말로", async () => {
    const d = (await api("GET", "/api/flows/calc")).draft;
    d.nodes[1].name = "하나 더하기";
    d.nodes[1].config.code = "return { m: input.n + 2 };";
    d.settings = { ...d.settings, retries: 2 };
    await api("PUT", "/api/flows/calc/draft", { draft: d });
    await page.goto(`${app.url}/#/flows/calc`);
    await page.locator(".relay-node").first().waitFor();
    await page.locator(".topbar-right button.primary").first().click();
    await page.getByRole("button", { name: /바뀐 것 보기/ }).click();
    const modal = page.getByRole("dialog", { name: "버전 비교" });
    await expect.poll(() => modal.innerText()).toContain("바뀐 것 3개");
    const text = await modal.innerText();
    expect(text).toContain("이름 «뒤» → «하나 더하기»");
    expect(text).toContain("설정이 바뀌었습니다 — 코드");
    expect(text).toContain("다시 해 보기이(가) 바뀌었습니다");
    if (shots) await page.screenshot({ path: join(shots, "p2-diff.png") });
    // 같은 것끼리는 «바뀐 것이 없습니다»
    await modal.getByLabel("지금").selectOption("1");
    await modal.getByText("바뀐 것이 없습니다").waitFor();
    await page.keyboard.press("Escape");
    await modal.getByTitle("닫기").click().catch(() => undefined);
  }, 60_000);

  it("★승인 기다리기 — 노드 설정 · 대시보드 · 실행 기록의 [승인]으로 이어 간다", async () => {
    // 노드 설정
    await page.goto(`${app.url}/#/flows/gated`);
    await page.locator(".relay-node", { hasText: "결재" }).click();
    await page.getByText("누가 승인하나").waitFor();
    expect(await page.locator(".field", { hasText: "누가 승인하나" }).locator("select").inputValue()).toBe("runner");
    if (shots) await page.screenshot({ path: join(shots, "p2-approval-node.png") });

    const { runId } = await api("POST", "/api/flows/gated/runs", {});
    await expect.poll(async () => (await api("GET", `/api/runs/${runId}/approval`))?.message ?? null, { timeout: 15_000 }).toBe("7건을 제출할까요?");
    // 대시보드 — 승인을 기다리는 실행
    await page.goto(`${app.url}/#/dashboard`);
    const box = page.locator(".dash-approvals");
    await box.waitFor();
    expect(await box.innerText()).toContain("주문 넣기 — «7건을 제출할까요?»");
    if (shots) await page.screenshot({ path: join(shots, "p2-approval-dash.png") });
    await box.locator("a").first().click();
    // 그 실행 — 띠에서 승인
    const wait = page.locator(".approval-wait");
    await wait.waitFor({ timeout: 15_000 });
    expect(await wait.innerText()).toContain("7건을 제출할까요?");
    await wait.getByLabel("한마디").fill("확인함");
    if (shots) await page.screenshot({ path: join(shots, "p2-approval-wait.png") });
    await wait.getByRole("button", { name: "승인" }).click();
    await expect.poll(async () => (await api("GET", `/api/runs/${runId}`)).status, { timeout: 15_000 }).toBe("success");
    expect((await api("GET", `/api/runs/${runId}`)).result.output).toEqual({ done: 7, by: null });
    await expect.poll(() => wait.count(), { timeout: 10_000 }).toBe(0);
  }, 60_000);

  it("★트리거 — 다른 워크플로우가 끝나면 · 파일이 생기면을 더하고 저장하면 설정에 남는다", async () => {
    await page.goto(`${app.url}/#/flows/calc`);
    await page.locator(".relay-node").first().waitFor();
    await page.getByTitle(/^트리거 —/).click();
    await page.getByRole("button", { name: "＋ 다른 워크플로우가 끝나면" }).click();
    await page.getByLabel("앞 워크플로우").selectOption("gated");
    await page.locator(".subcard", { has: page.getByLabel("앞 워크플로우") }).locator(".field", { hasText: "수" }).locator("input").fill("{{ $input.done }}");
    await page.getByRole("button", { name: "＋ 파일이 생기면" }).click();
    await page.locator(".field", { hasText: "공유 폴더 안의 폴더" }).locator("input").fill("주문요청");
    if (shots) await page.screenshot({ path: join(shots, "p2-triggers.png") });
    await page.keyboard.press("Control+s");
    await expect.poll(async () => (await api("GET", "/api/flows/calc")).draft.settings.after?.length ?? 0).toBe(1);
    const s = (await api("GET", "/api/flows/calc")).draft.settings;
    expect(s.after).toEqual([expect.objectContaining({ flowId: "gated", on: ["success"], params: { n: "{{ $input.done }}" }, enabled: true })]);
    expect(s.fileTriggers).toEqual([expect.objectContaining({ dir: "주문요청", pattern: "*.csv", param: "n", enabled: true })]);
    expect(await page.getByTitle(/^트리거 —/).locator(".trig-count").innerText()).toBe("2");
  }, 60_000);

  it("★팀 공용 값 — 팀 화면에서 넣고 · 워크플로우 설정에서 공용 변수 · 공용 시크릿을 고른다", async () => {
    await page.goto(`${app.url}/#/teams`);
    const pub = page.locator(".shared-card", { hasText: "공용 — 모든 팀" });
    await pub.waitFor();
    await pub.getByLabel("이름").fill("portal");
    await pub.getByLabel("값").fill("https://portal.example");
    await pub.getByRole("button", { name: /넣기/ }).click();
    await pub.getByText("https://portal.example").waitFor();
    await pub.getByLabel("종류").selectOption("login");
    await pub.getByLabel("이름").fill("acct");
    await pub.getByLabel("아이디").fill("kim");
    await pub.getByLabel("비밀번호").fill("pw-ui-shared-9");
    await pub.getByRole("button", { name: /넣기/ }).click();
    await pub.getByText("잠겨 있음").waitFor();
    expect(await page.content()).not.toContain("pw-ui-shared-9");
    if (shots) await page.screenshot({ path: join(shots, "p2-shared.png") });

    await page.goto(`${app.url}/#/flows/gated`);
    await page.locator(".relay-node").first().waitFor();
    await page.getByTitle(/워크플로우 설정/).click();
    await page.locator("label.check", { hasText: "portal" }).locator("input").check();
    await page.getByLabel("팀 공용 시크릿 쓰기").selectOption("acct");
    await page.getByText(/팀 공용 값 · 공용|팀 공용 값이 없습니다/).first().waitFor();
    if (shots) await page.screenshot({ path: join(shots, "p2-shared-flow.png") });
    await page.keyboard.press("Control+s");
    await expect.poll(async () => (await api("GET", "/api/flows/gated")).draft.sharedVars).toEqual(["portal"]);
    expect((await api("GET", "/api/flows/gated")).draft.secrets).toEqual([expect.objectContaining({ name: "acct", kind: "login", shared: true })]);
    // 저장하면 «팀 공용 값 · 공용»
    await page.locator(".pill", { hasText: "팀 공용 값 · 공용" }).waitFor();
  }, 60_000);
});
