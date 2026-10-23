/**
 * HTTP 요청 노드 — 채우기(쿼리 · 헤더 · JSON 본문) · 받기 · 4xx/5xx · 다시 해 보기(GET만) · 시간 제한 · 멈추기 · 시크릿 가림 (2026-10-16).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkFlow, parseFlow } from "@flowsmith/core";
import { blockedAddress, configureEngine, makeHttpGuard, runFlow } from "../src/index.ts";

let server: Server;
let base = "";
/** 길마다 몇 번 불렸나 */
const hits = new Map<string, number>();

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const n = (hits.get(url.pathname) ?? 0) + 1;
    hits.set(url.pathname, n);
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const json = (status: number, v: unknown) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "x-echo": "1" }); res.end(JSON.stringify(v)); };
      switch (url.pathname) {
        case "/echo": return json(200, { method: req.method, query: Object.fromEntries(url.searchParams), headers: { auth: req.headers.authorization ?? null, type: req.headers["content-type"] ?? null }, body });
        case "/text": res.writeHead(200, { "content-type": "text/plain" }); return res.end("안녕하세요");
        case "/missing": return json(404, { error: "없는 건" });
        case "/flaky": return n < 3 ? json(503, { error: "잠깐" }) : json(200, { ok: true, n });
        case "/always503": return json(503, { error: "계속 안 됨" });
        case "/slow": setTimeout(() => json(200, { late: true }), 5_000); return;
        default: return json(404, {});
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); });

const pos = { x: 0, y: 0 };
const flowOf = (config: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1, id: "http", name: "HTTP",
  secrets: [{ name: "apiKey", kind: "text" }],
  settings: { retryDelayMs: 50, defaultTimeoutMs: 2_000 },
  nodes: [
    { id: "src", type: "custom", name: "값", position: pos, config: { code: `return { title: '따옴표 "있는" 제목', count: 3, rows: [{ a: 1 }, { a: 2 }] };`, outputs: ["title", "count", "rows"] } },
    { id: "h", type: "http", name: "부르기", position: pos, config },
  ],
  edges: [{ id: "e1", from: { node: "src", port: "out" }, to: { node: "h" } }],
  ...extra,
});
const go = (config: Record<string, unknown>, opts: Parameters<typeof runFlow>[1] = {}) =>
  runFlow(parseFlow(flowOf(config)), { secrets: { apiKey: "sk-secret-123" }, ...opts });
const out = (r: Awaited<ReturnType<typeof runFlow>>) => r.nodes.find((n) => n.id === "h")!;

describe("채우기 · 받기", () => {
  it("★GET — 쿼리 · 헤더(시크릿)를 채우고 JSON을 읽는다 · 시크릿은 기록에서 가린다", async () => {
    const r = await go({
      method: "GET", url: `${base}/echo`,
      query: [{ name: "q", value: "{{ $input.title }}" }, { name: "n", value: "{{ $input.count }}" }],
      headers: [{ name: "Authorization", value: "Bearer {{ $secrets.apiKey }}" }],
    });
    expect(r.status, r.message).toBe("success");
    const o = out(r).output as any;
    expect(o).toMatchObject({ status: 200, ok: true, headers: { "x-echo": "1" } });
    expect(o.body.query).toEqual({ q: '따옴표 "있는" 제목', n: "3" });
    // 서버는 진짜 값을 받았고(되돌아온 본문에 있다) — 기록에는 가려져 남는다
    expect(o.body.headers.auth).toBe("Bearer ***");
    expect(JSON.stringify(r)).not.toContain("sk-secret-123");
    expect(out(r).logs[0]).toMatch(/^GET http:\/\/127\.0\.0\.1:\d+\/echo\?q=.+ → 200/);
  });

  it("★POST JSON — 글자 값 안에서 채운다(따옴표가 깨지지 않는다) · 값 하나뿐이면 값 그대로", async () => {
    const r = await go({
      method: "POST", url: `${base}/echo`,
      body: { kind: "json", text: '{ "title": "제목: {{ $input.title }}", "count": "{{ $input.count }}", "rows": "{{ $input.rows }}", "fixed": true }' },
    });
    expect(r.status, r.message).toBe("success");
    const echoed = (out(r).output as any).body;
    expect(echoed.headers.type).toMatch(/application\/json/);
    expect(JSON.parse(echoed.body)).toEqual({ title: '제목: 따옴표 "있는" 제목', count: 3, rows: [{ a: 1 }, { a: 2 }], fixed: true });
    // 본문 전체를 값 하나로
    const whole = await go({ method: "POST", url: `${base}/echo`, body: { kind: "json", text: "{{ $input.rows }}" } });
    expect(JSON.parse((out(whole).output as any).body.body)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("폼 · 글자 본문 · 글자 응답", async () => {
    const form = await go({ method: "POST", url: `${base}/echo`, body: { kind: "form", fields: [{ name: "제목", value: "{{ $input.title }}" }, { name: "key", value: "{{ $secrets.apiKey }}" }] } });
    const fb = (out(form).output as any).body;
    expect(fb.headers.type).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(fb.body).get("제목")).toBe('따옴표 "있는" 제목');
    const text = await go({ method: "GET", url: `${base}/text` });
    expect((out(text).output as any).body).toBe("안녕하세요");
  });
});

describe("실패 · 다시 해 보기", () => {
  it("★4xx — 기본은 노드 실패(상태 · 본문 일부를 적는다) · «그대로 넘김»이면 status · ok로", async () => {
    const fail = await go({ method: "GET", url: `${base}/missing` });
    expect(fail.status).toBe("failure");
    expect(out(fail).failure?.message).toMatch(/HTTP 404 .*없는 건/);
    const pass = await go({ method: "GET", url: `${base}/missing`, failOn: "never" });
    expect(pass.status).toBe("success");
    expect(out(pass).output).toMatchObject({ status: 404, ok: false, body: { error: "없는 건" } });
  });

  it("★GET은 5xx면 다시 해 본다 — POST는 다시 하지 않는다", async () => {
    hits.clear();
    const r = await go({ method: "GET", url: `${base}/flaky`, retries: 3 });
    expect(r.status, r.message).toBe("success");
    expect((out(r).output as any).body).toEqual({ ok: true, n: 3 });
    expect(out(r).logs.filter((l) => l.startsWith("다시 해 봅니다")).length).toBe(2);

    hits.clear();
    const post = await go({ method: "POST", url: `${base}/always503`, retries: 3, body: { kind: "json", text: "{}" } });
    expect(post.status).toBe("failure");
    expect(hits.get("/always503")).toBe(1);
  });

  it("시간 제한 → timeout · 멈추기는 기다리던 요청을 깨운다", async () => {
    const t = await go({ method: "GET", url: `${base}/slow`, timeoutMs: 300 });
    expect(out(t).failure).toMatchObject({ problem: "timeout" });
    expect(out(t).failure?.message).toMatch(/시간 안에 끝나지 않았습니다/);

    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 300);
    const t0 = Date.now();
    const s = await go({ method: "GET", url: `${base}/slow`, timeoutMs: 10_000 }, { signal: ctrl.signal });
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(s.status).toBe("cancelled");
  });

  it("연결 실패 — 까닭을 적는다 · 헤더에 한글은 보내지 못한다고 알린다", async () => {
    // 닫힌 포트 — 잠깐 열었다 닫는다
    const s = createServer();
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const port = (s.address() as AddressInfo).port;
    await new Promise((r) => s.close(r));
    const r = await go({ method: "GET", url: `http://127.0.0.1:${port}/nothing` });
    expect(out(r).failure?.message).toMatch(/연결하지 못했습니다\(ECONNREFUSED\)/);
    const ko = await go({ method: "GET", url: `${base}/echo`, headers: [{ name: "X-Title", value: "{{ $input.title }}" }] });
    expect(out(ko).failure?.message).toMatch(/헤더 'X-Title' 값에 쓸 수 없는 글자/);
  });
});

describe("검문소 · 점검", () => {
  it("★GET에 본문 · 읽을 수 없는 JSON · 주소에 시크릿 · http(s)가 아닌 주소 — 들어오지 못한다", () => {
    expect(checkFlow(flowOf({ method: "GET", url: `${base}/echo`, body: { kind: "json", text: "{}" } })).join("\n")).toMatch(/GET 요청에는 본문을 넣지 않습니다/);
    expect(checkFlow(flowOf({ method: "POST", url: `${base}/echo`, body: { kind: "json", text: '{ "a": {{ $input.count }} }' } })).join("\n")).toMatch(/JSON 본문을 읽을 수 없습니다/);
    expect(checkFlow(flowOf({ method: "GET", url: `${base}/echo?k={{ $secrets.apiKey }}` })).join("\n")).toMatch(/시크릿은/);
    expect(checkFlow(flowOf({ method: "GET", url: "ftp://x" })).join("\n")).toMatch(/http:\/\/ 또는 https:\/\//);
    expect(checkFlow(flowOf({ method: "GET", url: `${base}/echo`, headers: [{ name: "X Bad", value: "1" }] })).join("\n")).toMatch(/헤더 이름/);
    expect(checkFlow(flowOf({ method: "GET", url: `${base}/echo`, query: [{ name: "x", value: "{{ $input.nope }}" }] })).join("\n")).toMatch(/"nope"를 내놓지 않습니다/);
    expect(checkFlow(flowOf({ method: "POST", url: `${base}/echo`, headers: [{ name: "Authorization", value: "{{ $secrets.apiKey }}" }], body: { kind: "json", text: '{"k":"{{ $secrets.apiKey }}"}' } }))).toEqual([]);
  });

  it("★점검은 GET은 보내고, POST 앞에서는 멈춘다", async () => {
    hits.clear();
    const get = await go({ method: "GET", url: `${base}/echo` }, { probe: true });
    expect(get.probe?.stop.reason ?? "").not.toMatch(/HTTP/);
    expect(hits.get("/echo")).toBe(1);
    const post = await go({ method: "POST", url: `${base}/echo`, body: { kind: "json", text: "{}" } }, { probe: true });
    expect(post.probe?.stop.reason).toMatch(/HTTP POST 요청 앞에서 멈췄습니다/);
    expect(hits.get("/echo")).toBe(1);
  });
});

describe("엔진 정책 — 사내 서버형", () => {
  it("★주소 지킴이 — 서버 자기 자신 · 메타데이터는 막고, 사내 주소는 둔다", async () => {
    expect(blockedAddress("127.0.0.1")).toMatch(/자기 자신/);
    expect(blockedAddress("::ffff:127.0.0.9")).toMatch(/자기 자신/);
    expect(blockedAddress("::1")).toMatch(/자기 자신/);
    expect(blockedAddress("169.254.169.254")).toMatch(/메타데이터/);
    expect(blockedAddress("fe80::1")).toMatch(/링크 로컬/);
    expect(blockedAddress("10.1.2.3")).toBeNull();
    expect(blockedAddress("192.168.0.10")).toBeNull();
    expect(blockedAddress("10.20.0.5", ["10.20.0.0/16"])).toMatch(/관리자가 막은 주소/);
    await expect(makeHttpGuard()(new URL("http://localhost:4400/api/flows"))).rejects.toThrow(/자기 자신/);
    await expect(makeHttpGuard(["intranet.example"])(new URL("https://intranet.example/x"))).rejects.toThrow(/관리자가 막은 이름/);
    // 켜 두면 HTTP 요청 노드가 부르기 전에 막는다(이 시험의 서버는 127.0.0.1에 있다)
    configureEngine({ httpGuard: makeHttpGuard() });
    try {
      const r = await go({ method: "GET", url: `${base}/echo` });
      expect(r.status).toBe("failure");
      expect(out(r).failure?.message).toMatch(/이 주소는 부를 수 없습니다 — 서버 자기 자신/);
    } finally { configureEngine({ httpGuard: null }); }
  });

  it("★커스텀(코드) 노드를 끄면 그 노드에서 멈춘다 — «값 다듬기»로 바꾸라고", async () => {
    configureEngine({ customCode: false });
    try {
      const r = await go({ method: "GET", url: `${base}/echo` });
      expect(r.nodes.find((n) => n.id === "src")!.failure?.message).toMatch(/커스텀\(코드\) 노드를 돌리지 않습니다/);
    } finally { configureEngine({ customCode: true }); }
  });
});
