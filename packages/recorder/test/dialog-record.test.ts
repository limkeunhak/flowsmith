/**
 * 녹화 — 누르기가 띄운 브라우저 확인창(confirm · alert)에 사람이 답하면 그 누르기에 «확인창에 답하기»로 남는다(2026-10-26).
 *   확인 · 취소 · 녹화한 것이 엔진에서 그대로 돈다(확인창을 «확인»으로 넘겨야 등록되는 화면) · 둘러보기 모드의 확인창은 남기지 않는다
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
<button id="reg" onclick="document.getElementById('r').textContent = confirm('이미지FAX등록전에 반드시 고객동의여부를 재확인 바랍니다.\\r\\n\\r\\n불완전동의건은 불이익을 받을 수 있습니다.') ? '등록됨' : '취소됨'">등록</button>
<p id="r">아직</p>`;
const draft = () => ({
  schemaVersion: 1, id: "d", name: "d", settings: { defaultTimeoutMs: 3000 },
  nodes: [{ id: "w", type: "web", name: "등록", position: { x: 0, y: 0 }, config: { start: { kind: "url", url }, actions: [] } }],
  edges: [],
});

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

async function record(accept: boolean, mode: "record" | "browse" = "record"): Promise<{ items: Recorded[]; msgs: ServerMessage[]; result: string }> {
  const msgs: ServerMessage[] = [];
  const s = await RecorderSession.open(browser, { t: "open", flowId: "d", nodeId: "w", draft: draft() as never, params: {}, replay: false, replayExisting: false, viewport: { width: 1024, height: 700 } }, {}, { send: (m) => msgs.push(m), frame: () => undefined });
  try {
    await s.setMode(mode);
    // 둘러보기 모드면 가로채지 않아 이 누르기가 확인창이 닫힐 때까지 끝나지 않는다 — 기다리지 않고 답한다
    const clicking = s.page.locator("#reg").click();
    // 라이브 화면의 사람 — 확인창이 뜨면 답한다
    await expect.poll(() => msgs.some((m) => m.t === "dialog"), { timeout: 10_000 }).toBe(true);
    await s.input({ t: "dialog", accept });
    await clicking;
    await expect.poll(() => s.page.locator("#r").textContent()).toBe(accept ? "등록됨" : "취소됨");
    await s.settle();
    return { items: msgs.flatMap((m) => (m.t === "recorded" ? [m.item] : [])), msgs, result: (await s.page.locator("#r").textContent()) ?? "" };
  } finally { await s.close(); }
}

describe("녹화 — 브라우저 확인창에 답하기", () => {
  it("★«확인»으로 답하면 누르기에 남고, 녹화한 대로 엔진이 등록까지 간다", async () => {
    const { items, msgs } = await record(true);
    expect(items).toHaveLength(1);
    const a = items[0]!.action;
    expect(a.kind === "click" && a.dialog).toEqual({ accept: true, expect: "이미지FAX등록전에 반드시 고객동의여부를 재확인 바랍니다." });
    expect(items[0]!.hints?.join(" ")).toMatch(/확인창.*«확인»으로 답한 것을 함께 남겼습니다/);
    expect(msgs.filter((m) => m.t === "notice" && m.level === "error")).toEqual([]);   // 확인창이 떠 있는 동안의 누르기는 실패가 아니다
    const d = draft(); (d.nodes[0]!.config.actions as WebAction[]).push({ ...a, id: "a1" }, { id: "a2", kind: "read", risk: "safe", timeoutMs: null, optional: false, target: { label: "결과", locators: [{ kind: "css", value: "#r" }], fingerprint: null, frames: [], verifiedAt: null }, output: "r", strategy: "text", attribute: null, transform: null });
    const run = await runFlow(parseFlow(d), { browser });
    expect(run.status, JSON.stringify(run.nodes[0]!.failure)).toBe("success");
    expect(run.output).toEqual({ r: "등록됨" });
  }, 30_000);

  it("«취소»로 답한 것도 남는다 · 둘러보기 모드의 확인창은 남기지 않는다", async () => {
    const no = await record(false);
    expect(no.items[0]!.action.kind === "click" && no.items[0]!.action.dialog).toMatchObject({ accept: false });
    const browse = await record(true, "browse");
    expect(browse.items).toEqual([]);
    expect(browse.result).toBe("등록됨");
  }, 30_000);
});
