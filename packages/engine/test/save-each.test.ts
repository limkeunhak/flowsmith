/**
 * 행마다 반복 · 파일로 저장(PLAN §49) — 로그인한 브라우저로 페이지마다 PDF 내보내기를 받아 트리 경로대로 쓴다.
 * 가짜 위키: 쿠키가 있어야 PDF를 주고, 없으면 로그인 화면으로 보낸다(사내 위키처럼).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { parseFlow } from "@flowsmith/core";
import { runFlow } from "../src/index.ts";
import { safeFilePath } from "../src/nodes/web-node.ts";

let site: Server;
let url: string;
let browser: Browser;
let root: string;
let exports = 0;

const PAGES = [
  { id: "1", path: "[서비스파트]/개요" },
  { id: "2", path: "[서비스파트]/설계/API: 목록?" },
  { id: "403", path: "[서비스파트]/권한 없음" },
];

beforeAll(async () => {
  site = createServer((q, res) => {
    const u = new URL(q.url ?? "/", "http://x");
    const authed = (q.headers.cookie ?? "").includes("sid=ok");
    if (u.pathname === "/login") { res.writeHead(200, { "set-cookie": "sid=ok; Path=/; HttpOnly", "content-type": "text/html" }); res.end("<p id=me>로그인됨</p>"); return; }
    if (u.pathname === "/login.action") { res.writeHead(200, { "content-type": "text/html" }); res.end("<form>로그인하세요</form>"); return; }
    if (u.pathname === "/export") {
      if (!authed) { res.writeHead(302, { location: "/login.action?os_destination=x" }); res.end(); return; }
      const id = u.searchParams.get("pageId");
      if (id === "403") { res.writeHead(200, { "content-type": "text/html" }); res.end("<html>권한이 없습니다</html>"); return; }
      exports++;
      // 위키 내보내기처럼 임시 파일로 넘긴다
      res.writeHead(302, { location: `/download/temp/${id}.pdf` }); res.end(); return;
    }
    if (u.pathname.startsWith("/download/temp/")) { res.writeHead(200, { "content-type": "application/pdf" }); res.end(`%PDF-1.4\n% page ${u.pathname}\n%%EOF`); return; }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<h1 id=title>${u.searchParams.get("pageId") ?? "home"}</h1>`);
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  browser = await chromium.launch();
  root = mkdtempSync(join(tmpdir(), "fs-save-"));
});
afterAll(async () => {
  await browser?.close();
  await new Promise((r) => site?.close(r));
  rmSync(root, { recursive: true, force: true });
});

const target = (label: string, css: string) => ({ label, locators: [{ kind: "css", value: css }], fingerprint: null, frames: [], verifiedAt: null });
const crawl = (onError: "stop" | "continue", extra: Record<string, unknown> = {}) => parseFlow({
  schemaVersion: 1, id: "c", name: "c", params: [{ name: "pages", label: "페이지들", required: true, type: "text", default: "" }],
  settings: { defaultTimeoutMs: 5000 },
  nodes: [
    { id: "login", type: "web", name: "로그인", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: `${url}/login` }, actions: [] } },
    { id: "each", type: "web", name: "페이지마다", position: { x: 1, y: 0 }, config: {
      start: { kind: "url", url: `${url}/view?pageId={{ $item.id }}` },
      each: { items: "{{ $params.pages }}", onError },
      actions: [
        { id: "t", kind: "read", output: "title", target: target("제목", "#title") },
        { id: "s", kind: "save", source: "url", url: "/export?pageId={{ $item.id }}", path: "{{ $item.path }}.pdf", output: "file", skipExisting: true, ...extra },
      ],
    } },
  ],
  edges: [{ id: "e1", from: { node: "login", port: "out" }, to: { node: "each" } }],
});

describe("행마다 반복 · 파일로 저장", () => {
  it("★로그인한 브라우저로 행마다 PDF를 받아 트리 경로대로 쓴다 · PDF가 아니면 그 행만 실패 · 이미 있으면 건너뛴다", async () => {
    const r = await runFlow(crawl("continue"), { browser, params: { pages: JSON.stringify(PAGES) }, files: { root, flowUid: "uid1" } });
    expect(r.status, JSON.stringify(r.nodes.map((n) => n.failure))).toBe("success");
    const out = r.output as { rows: Record<string, unknown>[]; succeeded: number; failed: number };
    expect(out.succeeded).toBe(2);
    expect(out.failed).toBe(1);
    expect(out.rows[0]).toMatchObject({ id: "1", path: "[서비스파트]/개요", ok: true, title: "1", file: "[서비스파트]/개요.pdf" });
    // 파일 이름에 못 쓰는 글자(: ?)는 바뀐다
    expect(out.rows[1]).toMatchObject({ ok: true, file: "[서비스파트]/설계/API_ 목록_.pdf" });
    expect(out.rows[2]).toMatchObject({ id: "403", ok: false });
    expect(String(out.rows[2]!["error"])).toMatch(/PDF가 아닙니다.*권한이 없습니다/);
    expect(readFileSync(join(root, "uid1", "[서비스파트]", "개요.pdf"), "latin1")).toMatch(/^%PDF-1\.4/);
    expect(existsSync(join(root, "uid1", "[서비스파트]", "권한 없음.pdf"))).toBe(false);
    const steps = r.nodes[1]!.steps.map((s) => s.note).join("\n");
    expect(steps).toMatch(/\[1\/3\] .*개요\.pdf에 저장했습니다/);

    // 다시 돌리면 받은 것은 건너뛴다(끊긴 수집 이어 하기)
    const before = exports;
    const again = await runFlow(crawl("continue"), { browser, params: { pages: JSON.stringify(PAGES) }, files: { root, flowUid: "uid1" } });
    expect(exports).toBe(before);
    expect(again.nodes[1]!.steps.map((s) => s.note).join("\n")).toMatch(/이미 있어 건너뛰었습니다 — \[서비스파트\]\/개요\.pdf/);
  }, 60_000);

  it("★로그인이 풀려 로그인 화면으로 넘어가면 그 까닭으로 멈춘다(stop)", async () => {
    const f = crawl("stop", { skipExisting: false });
    // 로그인 노드를 건너뛴 것처럼 — 쿠키 없이
    const noLogin = { ...f, nodes: [f.nodes[1]!], edges: [] };
    const r = await runFlow(noLogin, { browser, params: { pages: JSON.stringify(PAGES.slice(0, 1)) }, files: { root, flowUid: "uid2" } });
    expect(r.status).toBe("failure");
    expect(r.nodes[0]!.failure!.message).toMatch(/로그인 화면.*으로 넘어갔습니다/);
  }, 60_000);

  it("검문소 — $item은 반복하는 노드 안에서만 · 반복은 주소로 시작 · 출력은 rows", () => {
    const f = crawl("continue");
    expect(f.nodes[1]!.type === "web" && f.nodes[1]!.config.each).toEqual({ items: "{{ $params.pages }}", onError: "continue" });
    const raw = (each: unknown, start: unknown = { kind: "url", url: `${url}/{{ $item.id }}` }) => () => parseFlow({
      schemaVersion: 1, id: "x", name: "x", nodes: [{ id: "w", type: "web", name: "w", position: { x: 0, y: 0 }, config: { start, ...(each ? { each } : {}), actions: [{ id: "a", kind: "wait", wait: { kind: "fixed", ms: 1 } }] } }], edges: [],
    });
    expect(raw(null)).toThrow(/\$item은 행마다 돌 때만/);
    // 앞 페이지에서 이어서도 반복할 수 있다(주소에서 받기만 하는 수집)
    const cont = crawl("continue");
    const eachNode = cont.nodes[1]!;
    if (eachNode.type === "web") eachNode.config.start = { kind: "continue" };
    expect(() => parseFlow(JSON.parse(JSON.stringify(cont)))).not.toThrow();
  });

  it("경로 다듬기 — 못 쓰는 글자 · 빈 마디 · 「..」 · 긴 이름", () => {
    expect(safeFilePath("a/b:c?.pdf")).toBe("a/b_c_.pdf");
    expect(safeFilePath("/a//b/")).toBe("a/b");
    expect(safeFilePath("../x/./y.pdf")).toBe("_/x/_/y.pdf");
    const long = safeFilePath(`${"가".repeat(100)}.pdf`);
    expect(Buffer.byteLength(long)).toBeLessThanOrEqual(180);
    expect(long.endsWith(".pdf")).toBe(true);
  });
});
