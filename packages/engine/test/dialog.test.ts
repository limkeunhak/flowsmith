/**
 * 누르면 뜨는 브라우저 확인창에 답하기(2026-10-26) — 등록 앞의 확인창(confirm)을 «확인»으로 넘겨야 등록되는 화면(NexusStudio에서 가져옴).
 *   확인 · 취소 · 문구가 다르면 취소하고 멈춤 · 안 뜨면 멈춤 · 확인하면 창이 스스로 닫혀도(팝업) 성공 · 답하지 않으면 예전처럼 취소로 닫힘
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
// «등록»은 확인창 — 확인이면 #result에 «등록됨», 취소면 «취소됨». «알림»은 다른 문구의 alert. «조용»은 확인창 없음
const PAGE = `<!doctype html><meta charset="utf-8">
<button id="reg" onclick="document.getElementById('result').textContent = confirm('이미지FAX등록전에 반드시 고객동의여부를 재확인 바랍니다.') ? '등록됨' : '취소됨'">등록</button>
<button id="warn" onclick="alert('\\'동의하지 않음\\'을 선택한 항목이 있습니다.'); document.getElementById('result').textContent = '알림 뒤'">알림</button>
<button id="quiet" onclick="document.getElementById('result').textContent = '조용'">조용</button>
<button id="open" onclick="window.open('/pop', 'pop', 'width=400,height=300')">창 열기</button>
<p id="result"></p>`;
const POP = `<!doctype html><meta charset="utf-8"><button id="ok" onclick="if (confirm('등록하시겠습니까?')) { window.opener.document.getElementById('result').textContent = '창에서 등록'; window.close(); }">등록</button>`;
const target = (label: string, css: string) => ({ label, locators: [{ kind: "css", value: css }], fingerprint: null, frames: [], verifiedAt: null });
const flow = (actions: unknown[]) => parseFlow({
  schemaVersion: 1, id: "d", name: "d", settings: { defaultTimeoutMs: 3000 },
  nodes: [{ id: "w", type: "web", name: "확인창", position: { x: 0, y: 0 }, config: { start: { kind: "url", url }, actions: [
    ...actions,
    { id: "r", kind: "read", output: "result", target: target("결과", "#result") },
  ] } }],
  edges: [],
});
const click = (id: string, css: string, extra: Record<string, unknown> = {}) => ({ id, kind: "click", risk: "unsafe", target: target(`'${id}' 단추`, css), ...extra });

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

describe("누르면 뜨는 브라우저 확인창에 답하기", () => {
  it("★«확인» · «취소» — 문구가 맞으면 답하고, 무엇에 답했는지 기록에 남긴다", async () => {
    const ok = await runFlow(flow([click("reg", "#reg", { dialog: { accept: true, expect: "이미지FAX등록전에" } })]), { browser });
    expect(ok.status).toBe("success");
    expect(ok.output).toEqual({ result: "등록됨" });
    expect(ok.nodes[0]!.steps.find((s) => s.id === "reg")!.note).toMatch(/확인창 «이미지FAX등록전에 반드시 고객동의여부를 재확인 바랍니다\.»에 «확인»$/);
    const no = await runFlow(flow([click("reg", "#reg", { dialog: { accept: false, expect: "" } })]), { browser });
    expect(no.output).toEqual({ result: "취소됨" });
  }, 30_000);

  it("★문구가 다르면 «취소»로 닫고 멈춘다 — «동의하지 않음» 알림을 등록 확인으로 넘기지 않는다", async () => {
    const r = await runFlow(flow([click("warn", "#warn", { dialog: { accept: true, expect: "이미지FAX등록전에" } })]), { browser });
    expect(r.status).toBe("failure");
    expect(r.nodes[0]!.failure).toMatchObject({ problem: "mismatch" });
    expect(r.nodes[0]!.failure!.message).toMatch(/확인창 문구가 다릅니다 — 기대 "이미지FAX등록전에" · 화면 "'동의하지 않음'을 선택한 항목이 있습니다\." — «취소»로 닫았습니다/);
  }, 30_000);

  it("★확인창이 뜨지 않으면 멈춘다(등록이 안 된 것을 된 것으로 넘기지 않는다)", async () => {
    const r = await runFlow(flow([click("quiet", "#quiet", { dialog: { accept: true, expect: "" } })]), { browser });
    expect(r.status).toBe("failure");
    expect(r.nodes[0]!.failure!.message).toMatch(/누른 뒤 브라우저 확인창이 뜨지 않았습니다/);
  }, 30_000);

  it("★팝업 창에서 «확인»하면 창이 스스로 닫혀도 성공 — 연 창으로 돌아와 이어 간다", async () => {
    const r = await runFlow(flow([
      click("open", "#open", { risk: "safe", popup: true }),
      click("ok", "#ok", { dialog: { accept: true, expect: "등록하시겠습니까" } }),
    ]), { browser });
    expect(r.status, JSON.stringify(r.nodes[0]!.failure)).toBe("success");
    expect(r.output).toEqual({ result: "창에서 등록" });
    expect(r.nodes[0]!.steps.find((s) => s.id === "ok")!.note).toMatch(/창이 닫혀 연 창으로 돌아왔습니다$/);
  }, 30_000);

  it("답하지 않는 누르기 — 예전처럼 확인창은 «취소»로 닫힌다 · 검문소는 dialog를 그대로 읽는다", async () => {
    const r = await runFlow(flow([click("reg", "#reg")]), { browser });
    expect(r.output).toEqual({ result: "취소됨" });
    const f = flow([click("reg", "#reg", { dialog: { accept: true, expect: "등록" } })]);
    const a = (f.nodes[0]!.config as { actions: { dialog?: unknown }[] }).actions[0]!;
    expect(a.dialog).toEqual({ accept: true, expect: "등록" });
    expect((flow([click("reg", "#reg")]).nodes[0]!.config as { actions: object[] }).actions[0]).not.toHaveProperty("dialog");
  }, 30_000);
});
