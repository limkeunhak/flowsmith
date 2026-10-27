/**
 * 새 창으로 옮기기(2026-10-27) — 누르기와 바로 이어지지 않고 열리는 창(확인창에 답한 뒤 · 늦게)으로 옮겨 가고, 닫히면 연 창으로 돌아온다.
 *   안 열리면 시간 제한 뒤 멈춘다 · 확인창 «아니오» 뒤에 열리는 창(경우에 따라 확인창이 하나 더 뜨는 화면)
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { parseFlow } from "@flowsmith/core";
import { runFlow } from "../src/index.ts";

let site: Server;
let url: string;
let browser: Browser;
const PAGE = `<!doctype html><meta charset="utf-8">
<button id="late" onclick="setTimeout(() => window.open('/pop', 'p', 'width=400,height=300'), 700)">늦게 여는 단추</button>
<button id="ask" onclick="if (!confirm('휴대폰 본인인증으로 진행하시겠습니까?')) window.open('/pop', 'p2', 'width=400,height=300')">FAX</button>
<button id="none">아무것도 안 여는 단추</button>
<p id="r">아직</p>`;
const POP = `<!doctype html><meta charset="utf-8"><h1 id="title">FAX발신</h1><button id="send" onclick="setTimeout(() => { window.opener.document.getElementById('r').textContent = '보냄'; window.close(); }, 200)">발신</button>`;
const target = (label: string, css: string) => ({ label, locators: [{ kind: "css", value: css }], fingerprint: null, frames: [], verifiedAt: null });
const flow = (actions: unknown[]) => parseFlow({
  schemaVersion: 1, id: "s", name: "s", settings: { defaultTimeoutMs: 4000 },
  nodes: [{ id: "w", type: "web", name: "창", position: { x: 0, y: 0 }, config: { start: { kind: "url", url }, actions } }],
  edges: [],
});
const read = (id: string, output: string, css: string) => ({ id, kind: "read", output, target: target(output, css) });

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

describe("새 창으로 옮기기", () => {
  it("★늦게 열린 창으로 옮겨 가 일하고, 창이 닫히면 연 창으로 돌아와 이어 간다", async () => {
    const r = await runFlow(flow([
      { id: "a", kind: "click", target: target("늦게 여는 단추", "#late") },
      { id: "b", kind: "switchWindow" },
      read("c", "title", "#title"),
      { id: "d", kind: "click", target: target("발신", "#send") },
      read("e", "result", "#r"),
    ]), { browser });
    expect(r.status, JSON.stringify(r.nodes[0]!.failure)).toBe("success");
    expect(r.output).toEqual({ title: "FAX발신", result: "보냄" });
    expect(r.nodes[0]!.steps.find((s) => s.id === "b")!.note).toMatch(/^새로 열린 창으로 옮겼습니다\(http.*\/pop\)$/);
  }, 30_000);

  it("★확인창에 «아니오»로 답한 뒤 열리는 창(누르기의 «새 창을 엽니다»로는 못 잡는다)", async () => {
    const r = await runFlow(flow([
      { id: "a", kind: "click", target: target("FAX", "#ask"), dialog: { accept: false, expect: "휴대폰 본인인증" } },
      { id: "b", kind: "switchWindow" },
      read("c", "title", "#title"),
    ]), { browser });
    expect(r.status, JSON.stringify(r.nodes[0]!.failure)).toBe("success");
    expect(r.output).toEqual({ title: "FAX발신" });
  }, 30_000);

  it("창이 안 열리면 시간 제한 뒤 멈춘다 · 검문소", async () => {
    const r = await runFlow(flow([
      { id: "a", kind: "click", target: target("아무것도 안 여는 단추", "#none") },
      { id: "b", kind: "switchWindow", timeoutMs: 1000 },
    ]), { browser });
    expect(r.status).toBe("failure");
    expect(r.nodes[0]!.failure).toMatchObject({ problem: "timeout" });
    expect(r.nodes[0]!.failure!.message).toMatch(/새 창이 열리지 않았습니다\(1\.0초 기다림\)/);
    const f = flow([{ id: "b", kind: "switchWindow" }]);
    expect((f.nodes[0]!.config as { actions: { kind: string }[] }).actions[0]).toMatchObject({ kind: "switchWindow", risk: "safe", optional: false });
  }, 30_000);
});
