/**
 * 녹화 — 누르기와 바로 이어지지 않고 열리는 창(2026-10-27): 늦게 열리면 «새 창으로 옮기기»가 남는다 · 곧바로 열리면 누르기의 «새 창을 엽니다».
 *   확인창에 답한 뒤 열리는 창은 그 누르기의 것(확인창 답 + 새 창). 녹화한 것이 엔진에서 그대로 돈다
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { parseFlow, type WebAction } from "@flowsmith/core";
import { runFlow } from "@flowsmith/engine";
import { RecorderSession, type Recorded, type ServerMessage } from "../src/index.ts";

let site: Server;
let url: string;
let browser: Browser;
const PAGE = `<!doctype html><meta charset="utf-8">
<button id="late" onclick="setTimeout(() => window.open('/pop', 'p', 'width=400,height=300'), 1200)">늦게 여는 단추</button>
<button id="now" onclick="window.open('/pop', 'q', 'width=400,height=300')">바로 여는 단추</button>
<button id="ask" onclick="if (!confirm('휴대폰 본인인증으로 진행하시겠습니까?')) window.open('/pop', 'r', 'width=400,height=300')">FAX</button>
<p id="r">아직</p>`;
const POP = `<!doctype html><meta charset="utf-8"><h1>FAX발신</h1><button id="send" onclick="window.opener.document.getElementById('r').textContent = '보냄'; window.close()">발신</button>`;
const draft = () => ({ schemaVersion: 1, id: "l", name: "l", settings: { defaultTimeoutMs: 5000 }, nodes: [{ id: "w", type: "web", name: "창", position: { x: 0, y: 0 }, config: { start: { kind: "url", url }, actions: [] as WebAction[] } }], edges: [] });

beforeAll(async () => {
  site = createServer((q, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(q.url === "/pop" ? POP : PAGE); });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await new Promise((r) => site?.close(r));
});

/** 단추를 누르고(확인창이면 답하고) 열린 창에서 «발신» — 녹화된 것과 그것을 엔진으로 돌린 결과 */
async function recordAndRun(button: string, answer?: boolean): Promise<{ kinds: string[]; items: Recorded[]; result: unknown }> {
  const msgs: ServerMessage[] = [];
  const d = draft();
  const s = await RecorderSession.open(browser, { t: "open", flowId: "l", nodeId: "w", draft: d as never, params: {}, replay: false, replayExisting: false, viewport: { width: 1024, height: 700 } }, {}, { send: (m) => msgs.push(m), frame: () => undefined });
  try {
    const main = s.page;
    const clicking = main.locator(button).click();
    if (answer !== undefined) {
      await expect.poll(() => msgs.some((m) => m.t === "dialog")).toBe(true);
      await s.input({ t: "dialog", accept: answer });
    }
    await clicking;
    await expect.poll(() => s.page !== main, { timeout: 10_000 }).toBe(true);
    await s.page.waitForLoadState();
    await s.settle();
    await s.page.locator("#send").click();
    await expect.poll(() => s.page === main, { timeout: 10_000 }).toBe(true);
    await s.settle();
    const items = msgs.flatMap((m) => (m.t === "recorded" ? [m.item] : []));
    d.nodes[0]!.config.actions = [...items.map((it, i) => ({ ...it.action, id: `a${i + 1}` })), { id: "r", kind: "read", risk: "safe", timeoutMs: null, optional: false, output: "r", strategy: "text", attribute: null, transform: null, target: { label: "결과", locators: [{ kind: "css", value: "#r" }], fingerprint: null, frames: [], verifiedAt: null } }];
    const run = await runFlow(parseFlow(d), { browser });
    return { kinds: items.map((it) => (it.action.kind === "click" && it.action.popup ? "click(새 창)" : it.action.kind)), items, result: run.status === "success" ? run.output : run.nodes[0]!.failure?.message };
  } finally { await s.close(); }
}

describe("녹화 — 누르기와 바로 이어지지 않고 열리는 창", () => {
  it("★늦게 열린 창 → «새 창으로 옮기기»가 남고, 녹화한 대로 엔진이 끝까지", async () => {
    const r = await recordAndRun("#late");
    expect(r.kinds).toEqual(["click", "switchWindow", "click"]);
    expect(r.result).toEqual({ r: "보냄" });
  }, 40_000);

  it("곧바로 열린 창 → 누르기의 «새 창을 엽니다»(옮기기는 남기지 않는다)", async () => {
    const r = await recordAndRun("#now");
    expect(r.kinds).toEqual(["click(새 창)", "click"]);
    expect(r.result).toEqual({ r: "보냄" });
  }, 40_000);

  it("★확인창에 «아니오»로 답한 뒤 열린 창 → 그 누르기에 확인창 답과 새 창이 함께", async () => {
    const r = await recordAndRun("#ask", false);
    expect(r.kinds).toEqual(["click(새 창)", "click"]);
    expect(r.items[0]!.action.kind === "click" && r.items[0]!.action.dialog).toMatchObject({ accept: false });
    expect(r.result).toEqual({ r: "보냄" });
  }, 40_000);
});
