/**
 * 사람 기다리기 — 로그인 · 인증처럼 사람이 직접 해야 하는 일을 실행이 멈춰 기다린다 (2026-10-17).
 *   로그인 화면일 때만 · 끝났다는 표시(사라짐 · 보임 · 주소) · 시간 초과 · 멈추기 · 사람이 만질 수 없는 실행 · 점검 · 검문소
 * ★사람의 손은 시험이 대신한다 — 실행이 «기다림»을 알리면 그 페이지에 로그인한다.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { checkFlow, parseFlow, type Flow } from "@flowsmith/core";
import { runFlow, type RunEvent } from "../src/index.ts";

/** 로그인 화면 — 비밀번호를 넣고 로그인하면 폼이 사라지고 환영 글이 뜨고 주소에 #home이 붙는다 */
const LOGIN_HTML = `<!doctype html><meta charset="utf-8">
  <form id="login" onsubmit="event.preventDefault(); if (document.getElementById('pw').value !== '') { this.remove(); document.getElementById('home').hidden = false; location.hash = 'home'; }">
    <input id="id" placeholder="아이디"><input id="pw" type="password" placeholder="비밀번호"><button id="go">로그인</button>
  </form>
  <div id="home" hidden><h1 id="welcome">환영합니다</h1><span id="name">김담당</span></div>`;
/**
 * 실제 사이트에서 걸린 꼴(2026-10-17) — 단계마다 **같은 자리에 제목을 바꿔 넣는** 화면 위에 본인인증 팝업이 뜬다.
 * 팝업 뒤에는 앞 단계 제목이 이미 그 자리에 보인다. 인증하면 팝업이 닫히고 그 자리의 제목이 다음 단계 것으로 바뀐다
 */
const STEP_HTML = `<!doctype html><meta charset="utf-8">
  <div id="banner"><div>메뉴</div><div><div><div><h3>주문을 위한 개인정보 처리 동의</h3></div></div></div></div>
  <div id="pop" style="position:fixed;inset:40px;background:#fff;border:1px solid"><a id="telecom" href="#">통신사를 선택해 주세요</a><button id="auth">본인인증</button></div>
  <script>document.getElementById('auth').onclick = () => { document.getElementById('pop').remove(); document.querySelector('#banner h3').textContent = '배송받을 주소를 선택해 주세요. NEW'; };</script>`;
const ALREADY_HTML = `<!doctype html><meta charset="utf-8"><div id="home"><h1 id="welcome">환영합니다</h1><span id="name">김담당</span></div>`;
/** 사람이 넣는 비밀번호 — 실행 기록 어디에도 나오면 안 된다 */
const PW = "pw-7731-zq";

let browser: Browser;
let server: Server;
let LOGIN = "";
let ALREADY = "";
let STEP = "";
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  server = createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(req.url?.startsWith("/already") ? ALREADY_HTML : req.url?.startsWith("/step") ? STEP_HTML : LOGIN_HTML); });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  LOGIN = `${base}/login`;
  ALREADY = `${base}/already`;
  STEP = `${base}/step`;
});
afterAll(async () => { await browser?.close(); server?.close(); });

const css = (label: string, value: string) => ({ label, locators: [{ kind: "css", value }], fingerprint: null, frames: [], verifiedAt: null });

const human = (extra: Record<string, unknown> = {}) => ({
  id: "h1", kind: "human", prompt: "포털에 로그인해 주세요", appears: css("로그인 단추", "#go"), done: { kind: "hidden", target: css("로그인 폼", "#login") }, ...extra,
});
const flow = (actions: unknown[], url?: string, settings: Record<string, unknown> = {}) => parseFlow({
  schemaVersion: 1, id: "hum", name: "사람",
  settings: { defaultTimeoutMs: 3000, ...settings },
  nodes: [{ id: "w", type: "web", name: "포털", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: url ?? LOGIN }, actions } }],
  edges: [],
});
const readName = { id: "r1", kind: "read", target: css("이름", "#name"), output: "name", strategy: "auto" };

/** 사람 대신 — «기다림»이 오면 잠깐 뒤에 로그인한다 */
function person(pw = PW, delayMs = 400) {
  let page: Page | null = null;
  const events: RunEvent[] = [];
  return {
    events,
    onPage: (p: Page) => { page = p; },
    onEvent: (e: RunEvent) => {
      events.push(e);
      if (e.kind === "human" && e.state === "waiting") {
        setTimeout(() => { void (async () => { await page!.fill("#id", "kim"); await page!.fill("#pw", pw); await page!.click("#go"); })(); }, delayMs);
      }
    },
  };
}

describe("사람 기다리기", () => {
  it("★로그인 화면이면 기다리고 · 사람이 로그인하면 이어 간다 · 기다림/끝을 알린다", async () => {
    const p = person();
    const r = await runFlow(flow([human(), readName]), { browser, human: true, onPage: p.onPage, onEvent: p.onEvent });
    expect(r.status, r.message).toBe("success");
    expect(r.output).toEqual({ name: "김담당" });
    const hum = p.events.filter((e): e is Extract<RunEvent, { kind: "human" }> => e.kind === "human");
    expect(hum.map((e) => e.state)).toEqual(["waiting", "done"]);
    expect(hum[0]).toMatchObject({ nodeId: "w", actionId: "h1", index: 1, prompt: "포털에 로그인해 주세요" });
    expect(Date.parse(hum[0]!.deadline!)).toBeGreaterThan(Date.now() + 4 * 60_000);   // 기본 5분
    const notes = r.nodes[0]!.steps.map((s) => s.note).join("\n");
    expect(notes).toMatch(/사람을 기다립니다/);
    expect(notes).toMatch(/사람이 끝냈습니다/);
    // ★사람이 넣은 것은 어디에도 남지 않는다
    expect(JSON.stringify(r)).not.toContain(PW);
    expect(JSON.stringify(p.events)).not.toContain(PW);
  }, 30_000);

  it("★로그인 화면이 아니면(이미 로그인) 기다리지 않는다", async () => {
    const p = person();
    const r = await runFlow(flow([human(), readName], ALREADY), { browser, human: true, onPage: p.onPage, onEvent: p.onEvent });
    expect(r.status, r.message).toBe("success");
    expect(p.events.some((e) => e.kind === "human")).toBe(false);
    expect(r.nodes[0]!.steps[1]!.note).toMatch(/없어 기다리지 않았습니다/);
  }, 30_000);

  it("«이 화면일 때만»이 없으면 · 끝났다는 표시가 이미 맞으면 기다리지 않는다 · 주소로 끝을 안다", async () => {
    const byUrl = human({ appears: null, done: { kind: "url", pattern: "#home$" } });
    const already = await runFlow(flow([byUrl], `${LOGIN}#home`), { browser, human: true });
    expect(already.nodes[0]!.steps[1]!.note).toMatch(/이미 끝나 있어/);
    const p = person();
    const r = await runFlow(flow([byUrl, readName]), { browser, human: true, onPage: p.onPage, onEvent: p.onEvent });
    expect(r.status, r.message).toBe("success");
  }, 30_000);

  it("★시간 안에 안 끝나면 실패한다 — 무엇을 기다렸는지 말한다", async () => {
    const f: Flow = flow([human(), readName]);
    (f.nodes[0]!.config as { actions: { timeoutMs: number | null }[] }).actions[0]!.timeoutMs = 800;   // 검문소는 10초부터 — 시험만 짧게
    const r = await runFlow(f, { browser, human: true });
    expect(r.status).toBe("failure");
    expect(r.nodes[0]!.failure).toMatchObject({ problem: "timeout" });
    expect(r.nodes[0]!.failure!.message).toMatch(/사람을 .*기다렸지만 끝나지 않았습니다 — «포털에 로그인해 주세요»/);
  }, 30_000);

  it("★기다리는 중에 멈추면 바로 «멈춤»", async () => {
    const ctrl = new AbortController();
    const events: RunEvent[] = [];
    const t0 = Date.now();
    const r = await runFlow(flow([human()]), { browser, human: true, signal: ctrl.signal, onEvent: (e) => { events.push(e); if (e.kind === "human" && e.state === "waiting") setTimeout(() => ctrl.abort(), 300); } });
    expect(r.status).toBe("cancelled");
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(events.filter((e) => e.kind === "human").map((e) => (e as { state: string }).state)).toEqual(["waiting", "stopped"]);
  }, 30_000);

  it("★사람이 만질 수 없는 실행(창 없는 브라우저 · 실행 화면 없음)이면 기다리지 않고 바로 멈춘다", async () => {
    const r = await runFlow(flow([human()]), { browser, human: false });
    expect(r.status).toBe("failure");
    expect(r.nodes[0]!.failure!.message).toMatch(/사람이 화면을 만질 수 없습니다/);
  }, 30_000);

  it("점검 실행은 사람 기다리기 앞에서 멈춘다", async () => {
    const r = await runFlow(flow([human(), readName]), { browser, human: true, probe: true });
    expect(r.probe?.stop).toMatchObject({ nodeId: "w", actionId: "h1" });
    expect(r.probe?.stop.reason).toMatch(/사람 기다리기 앞에서 멈췄습니다/);
  }, 30_000);
});

describe("사람 기다리기 — 팝업 뒤에 끝 표시가 이미 보일 때(단계마다 제목을 바꿔 넣는 화면)", () => {
  const fp = (text: string) => ({ tag: "h3", attrs: {}, text, nearText: "" });
  const title = { label: "'배송받을 주소를 선택해 주세요' 제목", locators: [{ kind: "css", value: "#banner > div:nth-of-type(2) > div > div:nth-of-type(1) > h3" }], fingerprint: fp("배송받을 주소를 선택해 주세요. NEW 여러 곳 동시 배송하기"), frames: [], verifiedAt: null };
  const certHuman = (extra: Record<string, unknown> = {}) => ({ id: "h1", kind: "human", prompt: "본인인증을 해 주세요", appears: css("통신사 선택", "#telecom"), done: { kind: "visible", target: title }, ...extra });
  /** 사람 — 잠깐 뒤에 인증한다 */
  const certify = (delayMs = 700) => {
    let page: Page | null = null;
    return {
      onPage: (p: Page) => { page = p; },
      onEvent: (e: RunEvent) => { if (e.kind === "human" && e.state === "waiting") setTimeout(() => { void page!.click("#auth"); }, delayMs); },
    };
  };

  it("★같은 자리의 다른 제목 · 아직 떠 있는 팝업으로는 끝나지 않는다 — 사람이 인증해야 이어 간다", async () => {
    const p = certify();
    const r = await runFlow(flow([certHuman()], STEP), { browser, human: true, ...p });
    expect(r.status, r.message).toBe("success");
    expect(r.nodes[0]!.steps.at(-1)!.ms).toBeGreaterThan(500);   // 바로 끝나지 않았다(전에는 11ms)
  }, 30_000);

  it("«이 화면일 때만»이 없어도 — 글자가 다른 제목으로는 «이미 끝남»이 아니다", async () => {
    const p = certify();
    const r = await runFlow(flow([certHuman({ appears: null })], STEP), { browser, human: true, ...p });
    expect(r.status, r.message).toBe("success");
    expect(r.nodes[0]!.steps.map((s) => s.note).join("\n")).toMatch(/사람을 기다립니다/);
  }, 30_000);

  it("시간이 다 되면 무엇이 안 맞았는지 말한다 — 팝업이 아직 보인다", async () => {
    const f: Flow = flow([certHuman({ done: { kind: "visible", target: { ...title, fingerprint: fp("주문을 위한 개인") } } })], STEP);
    (f.nodes[0]!.config as { actions: { timeoutMs: number | null }[] }).actions[0]!.timeoutMs = 800;
    const r = await runFlow(f, { browser, human: true });
    expect(r.status).toBe("failure");
    expect(r.nodes[0]!.failure!.message).toMatch(/«이 화면일 때만»의 통신사 선택이\(가\) 아직 보입니다/);
  }, 30_000);
});

describe("검문소", () => {
  const raw = (action: Record<string, unknown>, settings: Record<string, unknown> = {}) => ({
    schemaVersion: 1, id: "hum", name: "사람", settings,
    nodes: [{ id: "w", type: "web", name: "포털", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: "https://x.test" }, actions: [action] } }],
    edges: [],
  });
  it("안내 문구 · 끝났다는 표시 · 기다리는 시간(10초~30분) · «있을 때만»은 같이 못 켬 · 전체 시간 제한", () => {
    expect(checkFlow(raw(human()))).toEqual([]);
    expect(checkFlow(raw(human({ prompt: "" }))).join()).toMatch(/prompt/);
    expect(checkFlow(raw(human({ done: { kind: "fixed", ms: 1 } }))).join()).toMatch(/kind/);
    expect(checkFlow(raw(human({ done: { kind: "url", pattern: "(" } }))).length).toBeGreaterThan(0);
    expect(checkFlow(raw(human({ timeoutMs: 5000 }))).join()).toMatch(/10초~30분/);
    expect(checkFlow(raw(human({ timeoutMs: 60 * 60_000 }))).join()).toMatch(/10초~30분/);
    expect(checkFlow(raw(human({ optional: true }))).join()).toMatch(/이 화면일 때만/);
    expect(checkFlow(raw(human({ timeoutMs: 20 * 60_000 }), { runTimeoutMin: 10 })).join()).toMatch(/전체 시간 제한이 10분/);
    expect(checkFlow(raw(human({ timeoutMs: 20 * 60_000 }), { runTimeoutMin: null }))).toEqual([]);
  });
});
