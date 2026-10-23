/**
 * 사람의 크롬에서 녹화하기 (PLAN §9 B2).
 * «사람의 크롬»은 원격 디버깅 포트를 연 Chromium으로 흉내 낸다 — 사람이 시험 쇼핑몰(아래 startShop)에 로그인해 주문 상세 화면을 열어 둔다.
 *
 * ★사람의 것은 사람의 것이다 — 탭을 닫지 않고 · 크기를 바꾸지 않고 · 사람이 따로 연 탭은 따라가지 않고 ·
 *  끝나면 레코더가 꺼져서 사람이 누르는 것이 그대로 페이지에 간다.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type BrowserContext, type Page } from "playwright";
import { RecorderSession, type ServerMessage } from "../src/index.ts";

const PORT = 9700 + Math.floor(Math.random() * 200);
const CDP = `http://127.0.0.1:${PORT}`;

/**
 * 시험 쇼핑몰 — 로그인(쿠키) · 주문 목록(줄마다 고르기 칸) · 주문 상세(처음 뜨는 안내창 · 품목 팝업 단추) · 품목 팝업(닫기).
 *  계정 kim / p@ss
 */
const ORDERS = [
  { no: "A-1001", buyer: "김철수", status: "배송중", amount: "12,500원", items: [{ name: "연필", qty: 10 }, { name: "공책", qty: 3 }] },
  { no: "A-1002", buyer: "이영희", status: "취소", amount: "0원", items: [] },
];
async function startShop(): Promise<{ origin: string; close: () => Promise<void> }> {
  const sessions = new Set<string>();
  const page = (title: string, body: string) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title>`
    + `<style>#notice { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: none; } #notice[data-open="1"] { display: block; }</style></head>`
    + `<body><h1>${title}</h1>${body}</body></html>`;
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const html = (body: string, headers: Record<string, string> = {}) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...headers }); res.end(body); };
    const redirect = (to: string, headers: Record<string, string> = {}) => { res.writeHead(302, { location: to, ...headers }); res.end(); };
    if (u.pathname === "/login" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        const f = new URLSearchParams(raw);
        if (f.get("id") !== "kim" || f.get("pw") !== "p@ss") return html(page("로그인", `<p id="login_msg">아이디 · 비밀번호를 확인하세요</p>`));
        const s = Math.random().toString(36).slice(2);
        sessions.add(s);
        redirect("/main", { "set-cookie": `shop_sess=${s}; Path=/; HttpOnly` });
      });
      return;
    }
    if (u.pathname === "/login") {
      return html(page("로그인", `<form method="post" action="/login"><label for="login_id">아이디</label><input id="login_id" name="id">`
        + `<label for="login_pw">비밀번호</label><input id="login_pw" name="pw" type="password"><button id="btn_login" type="submit">로그인</button></form>`));
    }
    const sid = /(?:^|;\s*)shop_sess=(\w+)/.exec(req.headers.cookie ?? "")?.[1];
    if (sid === undefined || !sessions.has(sid)) return redirect("/login");
    if (u.pathname === "/main") return html(page("메인", `<a href="/orders" id="menu_orders">주문 목록</a>`));
    if (u.pathname === "/orders") {
      return html(page("주문 목록", `<table id="order_list"><thead><tr><th>고르기</th><th>주문번호</th><th>주문자</th><th>상태</th><th>금액</th></tr></thead><tbody>`
        + ORDERS.map((o, i) => `<tr id="pl_${i}"><td id="pl_${i}_sel" style="cursor:pointer">○</td><td>${o.no}</td><td>${o.buyer}</td><td>${o.status}</td><td>${o.amount}</td></tr>`).join("")
        + `</tbody></table><button type="button" id="btn_cancel">주문 취소</button>`));
    }
    const o = ORDERS.find((x) => x.no === u.searchParams.get("orderNo"));
    if (u.pathname === "/detail" && o) {
      return html(page("주문 상세", `<p>주문번호 <b id="d_orderNo">${o.no}</b> · 상태 <b id="d_status">${o.status}</b> · 금액 <b id="d_amount">${o.amount}</b></p>`
        + `<button id="btn_items" type="button">품목 보기</button>`
        + `<div id="notice" data-open="1"><p>점검 안내 — 처음 상세에 들어올 때 뜨는 안내창</p><button id="notice_ok" type="button">확인</button></div>`
        + `<script>document.getElementById("notice_ok").onclick = () => document.getElementById("notice").removeAttribute("data-open");`
        + `document.getElementById("btn_items").onclick = () => window.open("/items?orderNo=${o.no}", "shop_items", "width=520,height=420");</script>`));
    }
    if (u.pathname === "/items" && o) {
      return html(page("품목", `<table id="item_table"><thead><tr><th>품목</th><th>수량</th></tr></thead><tbody>`
        + o.items.map((it, i) => `<tr><td id="it_${i}_name">${it.name}</td><td id="it_${i}_qty">${it.qty}</td></tr>`).join("")
        + `</tbody></table><button id="btn_close" type="button" onclick="window.close()">닫기</button>`));
    }
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end(page("없음", "<p>없는 화면입니다</p>"));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((ok) => { server.closeAllConnections(); server.close(() => ok()); }),
  };
}

let site: { origin: string; close: () => Promise<void> };
let human: BrowserContext;
let humanTab: Page;
let profile: string;

const draft = (start: unknown) => ({
  schemaVersion: 1, id: "f", name: "f", description: "", params: [], vars: {}, secrets: [], edges: [],
  settings: { forbiddenLabels: ["주문 취소", "발행"], defaultTimeoutMs: 15000, monitorIntervalMin: null, probeParams: {}, browser: "attach", schedules: [] },
  nodes: [{ id: "n", type: "web", name: "상세 읽기", position: { x: 0, y: 0 }, config: { start, actions: [] } }],
}) as any;

describe("사람의 크롬에서 녹화", () => {
  beforeAll(async () => {
    site = await startShop();
    profile = mkdtempSync(join(tmpdir(), "human-chrome-"));
    human = await chromium.launchPersistentContext(profile, { args: [`--remote-debugging-port=${PORT}`], viewport: { width: 1100, height: 700 } });
    humanTab = human.pages()[0] ?? await human.newPage();
    await humanTab.goto(`${site.origin}/login`);
    await humanTab.fill("#login_id", "kim");
    await humanTab.fill("#login_pw", "p@ss");
    await humanTab.click("#btn_login");
    await humanTab.goto(`${site.origin}/detail?orderNo=A-1001`);
    await humanTab.click("#notice_ok");
  });
  afterAll(async () => {
    await human?.close();
    await site?.close();
    rmSync(profile, { recursive: true, force: true });
  });

  it("★사람이 연 탭에서 녹화한다 — 팝업은 따라가고, 사람이 연 탭은 따라가지 않고, 끝나면 사람의 탭은 그대로 · 레코더는 꺼진다", async () => {
    const host = new URL(site.origin).host;
    const msgs: ServerMessage[] = [];
    const tabsBefore = human.pages().length;
    const s = await RecorderSession.open({ cdpUrl: CDP }, {
      t: "open", flowId: "f", nodeId: "n", draft: draft({ kind: "tab", match: host }), params: {}, replay: false, replayExisting: false, viewport: { width: 500, height: 400 },
    }, {}, { send: (m) => msgs.push(m), frame: () => undefined });
    const recorded = () => msgs.flatMap((m) => (m.t === "recorded" ? [m.item] : []));
    try {
      expect(msgs.some((m) => m.t === "phase" && m.phase === "ready")).toBe(true);
      expect(s.page.url()).toContain("/detail?orderNo=A-1001");   // 사람의 탭 — 주소를 옮기지 않았다
      expect(msgs.find((m) => m.t === "viewport")).toMatchObject({ width: 1100, height: 700 });   // ★패널 크기로 바꾸지 않았다
      await s.input({ t: "resize", width: 400, height: 300 });
      expect(await humanTab.evaluate(() => (globalThis as any).innerWidth)).toBe(1100);

      // 사람이 녹화 도중 다른 탭을 연다 — 따라가지 않는다
      const other = await human.newPage();
      await other.goto(`${site.origin}/main`);
      // 사람: 품목 팝업을 열어 읽고 닫는다 — 사람의 크롬에서 직접(화면 패널이 아니라)
      await humanTab.bringToFront();
      await humanTab.click("#btn_items");
      await s.settle();
      await expect.poll(() => s.page.url()).toContain("/items");
      expect(s.page).not.toBe(other);
      await s.setMode("read");
      await s.page.click("#it_0_name");
      await s.settle();
      await s.setMode("record");
      await s.page.click("#btn_close");
      await s.settle();
      await expect.poll(() => s.page === humanTab || s.page.url().includes("/detail")).toBe(true);
      expect(recorded().map((i) => i.action.kind)).toEqual(["click", "read", "click"]);
      expect(recorded()[0]!.action.kind === "click" && (recorded()[0]!.action as any).popup).toBe(true);
      expect(recorded()[1]!.current).toBe("연필");
      await other.close();
    } finally {
      await s.close();
    }
    // ★사람의 탭은 그대로 · 우리가 연 탭은 없다
    expect(humanTab.isClosed()).toBe(false);
    expect(humanTab.url()).toContain("/detail?orderNo=A-1001");
    expect(human.pages().length).toBe(tabsBefore);
    // ★레코더가 꺼졌다 — 사람이 누르면 그대로 페이지에 간다(팝업이 정말 열린다)
    const [popup] = await Promise.all([human.waitForEvent("page"), humanTab.click("#btn_items")]);
    await popup.waitForLoadState();
    expect(popup.url()).toContain("/items");
    await popup.close();
  }, 90_000);

  it("«주소로 가서» 노드는 우리 탭을 하나 열어 녹화하고, 끝나면 그 탭만 닫는다", async () => {
    const tabsBefore = human.pages().length;
    const msgs: ServerMessage[] = [];
    const s = await RecorderSession.open({ cdpUrl: CDP }, {
      t: "open", flowId: "f", nodeId: "n", draft: draft({ kind: "url", url: `${site.origin}/orders?period=1m` }), params: {}, replay: false, replayExisting: false, viewport: { width: 500, height: 400 },
    }, {}, { send: (m) => msgs.push(m), frame: () => undefined });
    try {
      expect(human.pages().length).toBe(tabsBefore + 1);
      expect(s.page).not.toBe(humanTab);
      expect(s.page.url()).toContain("/orders");   // 사람의 로그인(쿠키)을 그대로 쓴다
      await s.page.click("#pl_0_sel");
      await s.settle();
      const row = msgs.flatMap((m) => (m.t === "recorded" ? [m.item] : []))[0]!;
      expect(row.row?.pick.keyLabel).toBe("주문번호");
    } finally {
      await s.close();
    }
    expect(human.pages().length).toBe(tabsBefore);
    expect(humanTab.isClosed()).toBe(false);
  }, 60_000);

  it("붙을 수 없으면 이유를 말한다 — 탭이 없을 때도", async () => {
    const io = { send: () => undefined, frame: () => undefined };
    await expect(RecorderSession.open({ cdpUrl: "http://127.0.0.1:1" }, {
      t: "open", flowId: "f", nodeId: "n", draft: draft({ kind: "url", url: "about:blank" }), params: {}, replay: false, replayExisting: false, viewport: { width: 500, height: 400 },
    }, {}, io)).rejects.toThrow(/사람의 크롬에 붙지 못했습니다/);
    await expect(RecorderSession.open({ cdpUrl: CDP }, {
      t: "open", flowId: "f", nodeId: "n", draft: draft({ kind: "tab", match: "portal.example" }), params: {}, replay: false, replayExisting: false, viewport: { width: 500, height: 400 },
    }, {}, io)).rejects.toThrow(/「portal.example」가 든 탭이 없습니다/);
  }, 30_000);
});
