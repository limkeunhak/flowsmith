/**
 * 녹화 — 어떤 id를 믿나(2026-10-27): 글자에 붙은 화면 코드(WebSquare 격자 «grd_cipa0032VOList_cell_0_3»)는 믿고,
 * WebSquare가 그릴 때 붙이는 wq_uuid_N · 숫자 덩어리(item-12345)는 믿지 않는다. 믿는 id가 있으면 구조 경로 대신 그것을 쓴다.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { RecorderSession, type Recorded, type ServerMessage } from "../src/index.ts";

let site: Server;
let url: string;
let browser: Browser;
const PAGE = `<!doctype html><meta charset="utf-8">
<div id="wq_uuid_98"><div></div><div><table><tbody>
  <tr><td id="grd_cipa0032VOList_cell_0_1">동의자1</td><td id="grd_cipa0032VOList_cell_0_3">이모의</td></tr>
  <tr><td id="grd_cipa0032VOList_cell_1_1">동의자2</td><td id="grd_cipa0032VOList_cell_1_3">박시험</td></tr>
</tbody></table></div></div>
<p id="wq_uuid_120">자동 id 글자</p><p id="item-12345">숫자 덩어리 id</p>
<iframe id="mdi_subWindow1_iframe" name="ZZUF0105U" src="/inner" width="300" height="80"></iframe>
<iframe id="memoFrame" src="/inner2" width="300" height="80"></iframe>`;
const INNER = `<!doctype html><meta charset="utf-8"><button id="button_search">조회</button>`;

beforeAll(async () => {
  site = createServer((q, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(q.url?.startsWith("/inner") ? INNER : PAGE); });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await new Promise((r) => site?.close(r));
});

describe("녹화 — 믿는 id", () => {
  it("★격자 칸의 화면 코드 id를 쓰고 · wq_uuid · 숫자 덩어리 id는 쓰지 않는다", async () => {
    const msgs: ServerMessage[] = [];
    const draft = { schemaVersion: 1, id: "i", name: "i", settings: { defaultTimeoutMs: 3000 }, nodes: [{ id: "w", type: "web", name: "읽기", position: { x: 0, y: 0 }, config: { start: { kind: "url", url }, actions: [] } }], edges: [] };
    const s = await RecorderSession.open(browser, { t: "open", flowId: "i", nodeId: "w", draft: draft as never, params: {}, replay: false, replayExisting: false, viewport: { width: 1024, height: 700 } }, {}, { send: (m) => msgs.push(m), frame: () => undefined });
    try {
      await s.setMode("read");
      for (const sel of ["#grd_cipa0032VOList_cell_0_3", "#wq_uuid_120", "#item-12345"]) { await s.page.locator(sel).click(); await s.settle(); }
      const [cell, uuid, num] = msgs.flatMap((m) => (m.t === "recorded" ? [m.item] : [])) as [Recorded, Recorded, Recorded];
      const first = (it: Recorded) => (it.action.kind === "read" ? it.action.target.locators[0] : null);
      expect(first(cell)).toEqual({ kind: "css", value: "#grd_cipa0032VOList_cell_0_3" });
      expect(first(uuid)!.value).not.toContain("wq_uuid_120");
      expect(first(num)!.value).not.toContain("item-12345");
    } finally { await s.close(); }
  }, 30_000);

  it("★iframe은 이름(화면 코드)으로 — MDI 창 차례 id(mdi_subWindow1_iframe)는 상담사가 연 창 수에 따라 바뀐다 · 이름이 없으면 id", async () => {
    const msgs: ServerMessage[] = [];
    const draft = { schemaVersion: 1, id: "i", name: "i", settings: { defaultTimeoutMs: 3000 }, nodes: [{ id: "w", type: "web", name: "누르기", position: { x: 0, y: 0 }, config: { start: { kind: "url", url }, actions: [] } }], edges: [] };
    const s = await RecorderSession.open(browser, { t: "open", flowId: "i", nodeId: "w", draft: draft as never, params: {}, replay: false, replayExisting: false, viewport: { width: 1024, height: 700 } }, {}, { send: (m) => msgs.push(m), frame: () => undefined });
    try {
      await s.page.frameLocator('iframe[name="ZZUF0105U"]').locator("#button_search").click(); await s.settle();
      await s.page.frameLocator("#memoFrame").locator("#button_search").click(); await s.settle();
      const [mdi, plain] = msgs.flatMap((m) => (m.t === "recorded" ? [m.item] : [])) as [Recorded, Recorded];
      expect(mdi.action.kind === "click" && mdi.action.target.frames).toEqual(['iframe[name="ZZUF0105U"]']);
      expect(plain.action.kind === "click" && plain.action.target.frames).toEqual(["#memoFrame"]);
    } finally { await s.close(); }
  }, 30_000);
});
