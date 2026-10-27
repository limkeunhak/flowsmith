/**
 * 막힘 갈래 화면 e2e(2026-10-19) — 고르면 안 되는 행이 있는 웹페이지 노드에 «막힘 · 구매확정» 출력이 보이고,
 * 그 갈래를 이어 두면 구매확정 건은 실패가 아니라 «막힘»으로 끝난다(캔버스 · 실행 기록 · 거르기).
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
let siteUrl: string;
const api = (method: string, path: string, body?: unknown) => fetch(`${app.url}${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).then((r) => r.json() as Promise<any>);

const LIST = `<!doctype html><meta charset="utf-8"><table id="orders"><tbody>
  <tr onclick="document.title='골랐다 T1'"><td>홍길동</td><td>T1</td><td>배송중</td></tr>
  <tr onclick="document.title='골랐다 T2'"><td>홍길동</td><td>T2</td><td>구매확정</td></tr>
</tbody></table><h1 id="title">주문 목록</h1>`;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-blocked-ui-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  site = createServer((_q, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(LIST); });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), staticDir: join(dir, "dist"), monitor: false, schedule: false, retention: false });
  const target = (label: string, css: string) => ({ label, locators: [{ kind: "css", value: css }], fingerprint: null, frames: [], verifiedAt: null });
  const draft = {
    schemaVersion: 1, id: "orders", name: "주문 고르기", settings: { defaultTimeoutMs: 3000 },
    params: [{ name: "orderNo", label: "주문번호", type: "text", required: true }],
    nodes: [
      { id: "w", type: "web", name: "주문 읽기", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: siteUrl }, actions: [
        { id: "p1", kind: "pickRow", pick: { label: "주문 목록", rows: target("주문 목록 행", "#orders > tbody > tr"), keyColumn: "td:nth-child(2)", keyLabel: "주문번호", value: "{{ $params.orderNo }}", click: "",
          refuse: { column: "td:nth-child(3)", values: ["구매확정"], reason: "구매가 확정된 주문는 고치면 안 됩니다" } } },
        { id: "r1", kind: "read", output: "title", target: target("제목", "#title") },
      ] } },
      { id: "q", type: "custom", name: "주문 넣기", position: { x: 300, y: 0 }, config: { code: "return { done: input.title };", outputs: ["done"] } },
      { id: "s", type: "custom", name: "막힌 건 기록", position: { x: 300, y: 200 }, config: { code: "return { why: input.blockedReason };", outputs: ["why"] } },
    ],
    edges: [{ id: "e1", from: { node: "w", port: "out" }, to: { node: "q" } }, { id: "e2", from: { node: "w", port: "blocked" }, to: { node: "s" } }],
  };
  expect((await api("POST", "/api/flows", { draft })).id ?? "orders").toBe("orders");
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await app?.close();
  await new Promise((r) => site?.close(r));
  rmSync(dir, { recursive: true, force: true });
});

describe("막힘 갈래", () => {
  it("★캔버스에 «막힘 · 구매확정» 출력이 보이고 · 구매확정 건은 «막힘»으로 끝나 그 갈래를 돈다", async () => {
    await page.goto(`${app.url}/#/flows/orders`);
    const tile = page.locator(".relay-node", { hasText: "주문 읽기" });
    await tile.waitFor();
    expect(await tile.locator(".port-label.blocked").innerText()).toBe("막힘 · 구매확정");

    const { runId } = await api("POST", "/api/flows/orders/runs", { version: "draft", params: { orderNo: "T2" } });
    await expect.poll(async () => (await api("GET", `/api/runs/${runId}`)).status, { timeout: 20_000 }).toBe("blocked");
    const r = await api("GET", `/api/runs/${runId}`);
    expect(r.message).toMatch(/구매가 확정된 주문는 고치면 안 됩니다/);
    expect(r.result.output.why).toMatch(/주문번호 "T2"/);
    expect(r.result.nodes.map((n: any) => [n.id, n.status])).toEqual([["w", "blocked"], ["q", "skipped"], ["s", "succeeded"]]);

    // 실행 기록 — 막힘 거르기 · 캔버스 표시 · 로그의 띠
    await page.goto(`${app.url}/#/flows/orders/runs/${runId}`);
    await page.locator(".runlog").waitFor({ timeout: 15_000 });
    await page.locator(".relay-node", { hasText: "주문 읽기" }).locator(".tile-badge.blocked").waitFor();
    expect(await page.locator(".runlog-detail .banner").first().innerText()).toMatch(/🚫 막힘 — .*구매가 확정된 주문/);
    if (shots) await page.screenshot({ path: join(shots, "blocked-run.png") });
    await page.getByRole("button", { name: "막힘", exact: true }).click();
    await expect.poll(() => page.getByText(/막힘/).count()).toBeGreaterThan(0);

    // 막히지 않는 건은 정상 갈래 · 성공
    const ok = await api("POST", "/api/flows/orders/runs", { version: "draft", params: { orderNo: "T1" } });
    await expect.poll(async () => (await api("GET", `/api/runs/${ok.runId}`)).status, { timeout: 20_000 }).toBe("success");
    expect((await api("GET", `/api/runs/${ok.runId}`)).result.nodes.map((n: any) => [n.id, n.status])).toEqual([["w", "succeeded"], ["q", "succeeded"], ["s", "skipped"]]);
  }, 90_000);

  it("★막힘 갈래를 잇지 않으면 → «멈춤» 표시 · 실행은 실패지만 캔버스는 막힘으로", async () => {
    const d = (await api("GET", "/api/flows/orders")).draft;
    d.edges = d.edges.filter((e: any) => e.id !== "e2");
    d.nodes = d.nodes.filter((n: any) => n.id !== "s");
    await api("PUT", "/api/flows/orders/draft", { draft: d });
    await page.goto(`${app.url}/#/flows/orders`);
    await page.reload();   // 같은 워크플로우 안의 이동(실행 기록 → 편집기)은 초안을 다시 읽지 않는다 — 서버에서 바꾼 것을 읽게
    const tile = page.locator(".relay-node", { hasText: "주문 읽기" });
    await tile.waitFor();
    expect(await tile.locator(".port-label.blocked").innerText()).toBe("막힘 · 구매확정 → 멈춤");
    const { runId } = await api("POST", "/api/flows/orders/runs", { version: "draft", params: { orderNo: "T2" } });
    await expect.poll(async () => (await api("GET", `/api/runs/${runId}`)).status, { timeout: 20_000 }).toBe("failure");
    await page.goto(`${app.url}/#/flows/orders/runs/${runId}`);
    await page.locator(".relay-node", { hasText: "주문 읽기" }).locator(".tile-badge.blocked").waitFor({ timeout: 15_000 });
  }, 60_000);
});
