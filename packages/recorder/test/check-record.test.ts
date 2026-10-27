/**
 * 녹화 — 체크 칸(2026-10-26): 칸을 직접 누르면 브라우저가 click 전에 값을 먼저 바꾼다. 그 값(사람이 바란 값)으로 «켜기»가 남고 세션이 대신 켠다.
 *   라벨을 눌러도 같다 · 켜진 칸을 누르면 «끄기». 예전에는 «지금 값의 반대»를 남겨 켜기가 끄기로 녹화됐다
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { RecorderSession, type Recorded, type ServerMessage } from "../src/index.ts";

let site: Server;
let url: string;
let browser: Browser;
const PAGE = `<!doctype html><meta charset="utf-8"><label for="agree">동의</label><input type="checkbox" id="agree"><input type="checkbox" id="on" checked><label id="lbl" for="agree">동의(라벨)</label>`;

beforeAll(async () => {
  site = createServer((_q, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE); });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await new Promise((r) => site?.close(r));
});

describe("녹화 — 체크 칸", () => {
  it("★칸을 누르면 «켜기»로 남고 실제로 켜진다 · 켜진 칸은 «끄기» · 라벨을 눌러도 «켜기»", async () => {
    const msgs: ServerMessage[] = [];
    const draft = { schemaVersion: 1, id: "c", name: "c", settings: { defaultTimeoutMs: 3000 }, nodes: [{ id: "w", type: "web", name: "체크", position: { x: 0, y: 0 }, config: { start: { kind: "url", url }, actions: [] } }], edges: [] };
    const s = await RecorderSession.open(browser, { t: "open", flowId: "c", nodeId: "w", draft: draft as never, params: {}, replay: false, replayExisting: false, viewport: { width: 1024, height: 700 } }, {}, { send: (m) => msgs.push(m), frame: () => undefined });
    try {
      await s.page.locator("#agree").click(); await s.settle();
      await s.page.locator("#on").click(); await s.settle();
      await s.page.locator("#agree").click(); await s.settle();           // 켜진 것을 다시 — 끄기
      await s.page.locator("#lbl").click(); await s.settle();             // 라벨 — 켜기
      const items = msgs.flatMap((m) => (m.t === "recorded" ? [m.item] : [])) as Recorded[];
      expect(items.map((it) => it.action.kind === "check" && it.action.checked)).toEqual([true, false, false, true]);
      expect(await s.page.locator("#agree").isChecked()).toBe(true);
      expect(await s.page.locator("#on").isChecked()).toBe(false);
      expect(msgs.filter((m) => m.t === "notice" && m.level === "error")).toEqual([]);
    } finally { await s.close(); }
  }, 30_000);
});
