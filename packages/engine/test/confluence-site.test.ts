/**
 * Confluence 클론(PLAN §53) — 가짜 위키(로그인 쿠키가 있어야 그림을 준다)에서 confluence-html 워크플로우를 끝까지 돌리고
 * (HTML · 그림 · 첨부 · zip), 사이트 만들기 스크립트로 정적 사이트를 지어 file://로 연다 — 그림이 보이고 · 페이지 링크가 로컬로 · 트리 · 검색.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { parseFlow, safeFilePath as coreSafe } from "@flowsmith/core";
import { runFlow } from "../src/index.ts";
import { buildSite, checkOut, linkTarget, mainContent, safeFilePath } from "../../../examples/confluence/site/build.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const T = (id: string, title: string, anc: string[] = []) => ({ id, title, ancestors: anc.map((t) => ({ title: t })), space: { key: "SP" } });
const kids: Record<string, ReturnType<typeof T>[]> = {
  "1": [T("8", "08. 플랫폼개발")],
  "8": [T("10", "[서비스 파트]")],
  "10": [T("11", "개요"), T("13", "운영: 절차?")],
  "13": [T("131", "장애 대응")],
};
/** 페이지마다 본문 — 그림(늦게 싣는 것 · 썸네일) · 첨부 · 페이지 링크 셋(pageId · /display · /spaces) · 밖 링크 · 스크립트 */
const BODY: Record<string, string> = {
  "10": `<p>서비스 파트 첫 화면</p><p><a href="/pages/viewpage.action?pageId=11">개요로</a></p>`,
  "11": `<h2>개요</h2><p><img class="confluence-embedded-image" src="/download/thumbnails/11/%EA%B7%B8%EB%A6%BC%201.png?version=1&amp;api=v2" data-image-src="/download/attachments/11/%EA%B7%B8%EB%A6%BC%201.png?version=1&amp;api=v2"></p>
    <p><a href="/display/SP/%EC%9E%A5%EC%95%A0+%EB%8C%80%EC%9D%91">장애 대응 보기</a> · <a href="/spaces/SP/pages/13/x">운영</a> · <a href="/download/attachments/11/%EC%84%A4%EA%B3%84.pdf?version=2">설계.pdf</a> · <a href="https://example.com/docs">밖</a></p>
    <script>alert(1)</script><p onclick="alert(2)">운영 지표 대시보드</p>`,
  "13": `<p>운영 절차 <img src="/images/icons/emoticons/smile.svg"></p>`,
  "131": `<p>장애가 나면 <a href="/pages/viewpage.action?pageId=11#h-개요">개요</a>를 본다</p><p><a href="/pages/viewpage.action?pageId=999">없는 페이지</a></p>`,
};

let wiki: Server;
let base: string;
let browser: Browser;
let root: string;

beforeAll(async () => {
  wiki = createServer((q, res) => {
    const u = new URL(q.url ?? "/", "http://x");
    const authed = (q.headers.cookie ?? "").includes("JSESSIONID=ok");
    const json = (o: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (u.pathname === "/fake-login") { res.writeHead(302, { "set-cookie": "JSESSIONID=ok; Path=/; HttpOnly", location: "/index.action" }); res.end(); return; }
    if (u.pathname === "/index.action") { res.writeHead(200, { "content-type": "text/html" }); res.end("<h1>대시보드</h1>"); return; }
    if (!authed) { res.writeHead(302, { location: "/login.action" }); res.end(); return; }
    if (u.pathname === "/rest/api/content/search") return json({ results: (u.searchParams.get("cql") ?? "").includes('title="05. 팀 별 공간"') ? [T("1", "05. 팀 별 공간", ["자료실"])] : [] });
    const child = /^\/rest\/api\/content\/(\d+)\/child\/page$/.exec(u.pathname);
    if (child) return json({ results: kids[child[1]!] ?? [] });
    const one = /^\/rest\/api\/content\/(\d+)$/.exec(u.pathname);
    if (one) return json({ id: one[1], body: { view: { value: BODY[one[1]!] ?? "" } } });
    if (u.pathname === "/pages/viewpage.action") {
      const id = u.searchParams.get("pageId")!;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<html><head><title>${id} - 위키</title><link rel="stylesheet" href="/s/batch.css"></head><body><div id="header">메뉴</div><div id="main"><div id="main-content" class="wiki-content"><div>${BODY[id] ?? ""}</div></div></div></body></html>`);
      return;
    }
    if (u.pathname.startsWith("/download/") || u.pathname.startsWith("/images/")) {
      const pdf = u.pathname.endsWith(".pdf");
      res.writeHead(200, { "content-type": pdf ? "application/pdf" : u.pathname.endsWith(".svg") ? "image/svg+xml" : "image/png" });
      res.end(pdf ? "%PDF-1.4 설계" : u.pathname.endsWith(".svg") ? `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="5"/></svg>` : PNG);
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => wiki.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(wiki.address() as AddressInfo).port}`;
  browser = await chromium.launch();
  root = mkdtempSync(join(tmpdir(), "fs-conf-site-"));
});
afterAll(async () => {
  await browser?.close();
  await new Promise((r) => wiki?.close(r));
  // FLOWSMITH_KEEP=1 — 만든 사이트를 남겨 눈으로 본다
  if (process.env["FLOWSMITH_KEEP"]) console.log(`사이트: ${join(root, "site")}`); else rmSync(root, { recursive: true, force: true });
});

describe("Confluence 클론", () => {
  it("★워크플로우(HTML · 그림 · 첨부 · zip) → 사이트 만들기 → file://로 열면 그림 · 로컬 링크 · 트리 · 검색", async () => {
    const raw = JSON.parse(readFileSync(new URL("../../../examples/confluence/confluence-html.json", import.meta.url), "utf8"));
    // 로그인(사람)은 쿠키 넣기로
    raw.nodes[0].config.start.url = `${base}/fake-login`;
    raw.nodes[0].config.actions = [];
    const r = await runFlow(parseFlow(raw), { browser, params: { base, area: "content", assets: "all", zipName: "위키" }, files: { root, flowUid: "u1" } });
    expect(r.status, JSON.stringify(r.nodes.map((n) => [n.id, n.status, n.failure?.message]))).toBe("success");
    const dir = join(root, "u1");
    expect(r.nodes.find((n) => n.id === "assetList")!.output).toMatchObject({ count: 4 });   // 썸네일 · 원본 · PDF · 아이콘(밖 · 페이지 링크는 빼고)
    expect(existsSync(join(dir, "assets", "download", "attachments", "11", "그림 1.png"))).toBe(true);
    expect(existsSync(join(dir, "위키.zip"))).toBe(true);

    // 사이트 만들기
    const out = join(root, "site");
    const rep = await buildSite(dir, out, { zip: true });
    expect(rep).toMatchObject({ pages: 4, missing: [], assets: 4 });
    expect(rep.unresolved).toEqual(["/pages/viewpage.action"]);   // 받지 않은 페이지(999)는 원래 주소로
    expect(existsSync(`${out}.zip`)).toBe(true);
    const html = readFileSync(join(out, "pages", "[서비스 파트]", "개요.html"), "utf8");
    expect(html).not.toMatch(/<script>alert|onclick|메뉴|batch\.css/);

    // file://로 연다
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(pathToFileURL(join(out, "pages", "[서비스 파트]", "개요.html")).href);
    // 그림 — 늦게 싣는 그림의 원본으로 · 실제로 그려진다
    const img = page.locator("article img").first();
    expect(await img.evaluate((e) => (e as unknown as { naturalWidth: number }).naturalWidth)).toBe(1);
    // 트리 — 네 쪽 · 지금 페이지 표시
    expect(await page.locator("#tree a").count()).toBe(4);
    expect(await page.locator("#tree a.here").innerText()).toBe("개요");
    // 경로 · 밖 링크는 새 창
    expect(await page.locator(".crumbs").innerText()).toBe("[서비스 파트]");
    expect(await page.locator('a[href="https://example.com/docs"]').getAttribute("target")).toBe("_blank");
    // 첨부 PDF는 로컬로
    expect(await page.locator("article a", { hasText: "설계.pdf" }).getAttribute("href")).toBe("../../assets/download/attachments/11/%EC%84%A4%EA%B3%84.pdf");
    // /display/…/제목 → 그 페이지 파일
    await page.locator("article a", { hasText: "장애 대응 보기" }).click();
    expect(decodeURIComponent(page.url())).toMatch(/pages\/\[서비스 파트\]\/운영_ 절차_\/장애 대응\.html$/);
    // 검색 — 본문의 낱말로
    await page.locator("#q").fill("대시보드");
    await page.locator("#hits a").first().waitFor();
    expect(await page.locator("#hits a b").allInnerTexts()).toEqual(["개요"]);
    // 첫 화면(index.html)도 링크가 맞다
    await page.goto(pathToFileURL(join(out, "index.html")).href);
    await page.locator("article a", { hasText: "개요로" }).click();
    expect(decodeURIComponent(page.url())).toMatch(/pages\/\[서비스 파트\]\/개요\.html$/);
    expect(errors).toEqual([]);

    // ★입력과 출력이 같으면 · 출력이 입력 안이면 멈추고 수집한 것은 그대로
    const before = readdirSync(dir).sort();
    await expect(buildSite(dir, dir)).rejects.toThrow(/입력과 출력이 같은 폴더/);
    await expect(buildSite(dir, join(dir, "site"))).rejects.toThrow(/출력 폴더가 입력 폴더 안/);
    await expect(buildSite(dir, root)).rejects.toThrow(/입력 폴더가 출력 폴더 안/);
    expect(readdirSync(dir).sort()).toEqual(before);
    // 이 스크립트가 만든 것이 아닌 폴더는 비우지 않는다 · 만든 것은 다시 만든다
    const other = join(root, "남의 것");
    mkdirSync(other); writeFileSync(join(other, "중요.txt"), "x");
    await expect(buildSite(dir, other)).rejects.toThrow(/비어 있지 않습니다/);
    expect(existsSync(join(other, "중요.txt"))).toBe(true);
    await expect(buildSite(dir, out)).resolves.toMatchObject({ pages: 4 });

    // ★site/ 폴더만 다른 곳에 복사해 돌린다(저장소 밖 — Flowsmith 코드를 불러오지 않는다)
    const copy = join(root, "복사본");
    cpSync(new URL("../../../examples/confluence/site", import.meta.url), copy, { recursive: true });
    const log = execFileSync(process.execPath, [join(copy, "build.ts"), dir, join(root, "사이트2"), "--zip"], { encoding: "utf8" });
    expect(log).toMatch(/페이지 4쪽\(받지 못함 0\) · 그림 · 첨부 4개/);
    expect(existsSync(join(root, "사이트2", "index.html"))).toBe(true);
    expect(existsSync(join(root, "사이트2.zip"))).toBe(true);
    const bad = (() => { try { execFileSync(process.execPath, [join(copy, "build.ts"), dir, dir], { encoding: "utf8", stdio: "pipe" }); return ""; } catch (e) { return String((e as { stderr: string }).stderr); } })();
    expect(bad).toMatch(/멈췄습니다 — 입력과 출력이 같은 폴더/);
  }, 120_000);

  it("경로 다듬기 — 스크립트의 것이 Flowsmith core와 같다(워크플로우가 저장한 이름을 찾는다)", () => {
    for (const x of ["a/b:c?.pdf", "/a//b/", "../x/./y.html", "[서비스 파트]/운영: 절차?/장애 대응", `${"가".repeat(100)}.html`, "탭\t이름 *.png", "끝점...", "  "]) expect(safeFilePath(x)).toBe(coreSafe(x));
    expect(() => checkOut("/a/b", "/a/b/")).toThrow(/같은 폴더/);
  });

  it("본문 꺼내기 · 링크 대상", () => {
    expect(mainContent(`<body><div id="x"><div id="main-content"><div>a</div><div>b</div></div><div>밖</div></div></body>`)).toBe(`<div id="main-content"><div>a</div><div>b</div></div>`);
    expect(mainContent(`<html><body><p>몸통</p></body></html>`)).toBe("<p>몸통</p>");
    const p = { id: "5", title: "가 나", path: "가 나", depth: 0, site: "pages/가 나.html", src: null };
    const maps = [new Map([["5", p]]), new Map([["가 나", p]]), new Set(["assets/download/attachments/5/a.png"])] as const;
    expect(linkTarget(new URL("http://w/display/K/%EA%B0%80+%EB%82%98"), ...maps)).toEqual({ site: "pages/가 나.html", kind: "page" });
    expect(linkTarget(new URL("http://w/download/thumbnails/5/a.png?v=1"), ...maps)).toEqual({ site: "assets/download/attachments/5/a.png", kind: "asset" });
    expect(linkTarget(new URL("http://w/pages/viewpage.action?pageId=6"), ...maps)).toBeNull();
  });
});
