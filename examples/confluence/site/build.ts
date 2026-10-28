#!/usr/bin/env node
/**
 * Confluence HTML 수집 결과 → 로그인 없이 열리는 정적 사이트(PLAN §53).
 *
 *   node build.ts <수집 폴더> <사이트 폴더> [--zip]        — 이 폴더(site/)만 복사해 어디서든(Node 24 · 의존 없음)
 *
 *   수집 폴더 — confluence-html 워크플로우의 결과(zip을 푼 것 · 또는 서버의 워크플로우 폴더): pages.csv · html/ · assets/
 *   사이트 폴더 — index.html을 파일로 바로 연다(서버 없이). --zip이면 «사이트 폴더.zip»도 만든다
 *
 * 하는 일: 페이지마다 위키 본문(#main-content)을 꺼내 → 링크 · 그림을 로컬 경로로 바꾸고(페이지 id · /display/…/제목 ·
 *  /spaces/…/pages/id · 첨부 · 썸네일 · 아이콘) → 스크립트 · on… 속성은 걷어 내고 → 트리 · 경로 · 검색이 있는 틀을 씌운다.
 * ★위키 밖 링크 · 받지 못한 그림은 원래 주소로 남긴다(로그인한 브라우저에서만 열린다) — 몇 개인지 알린다.
 * ★사내 위키 내용이다 — 만든 사이트는 사내에서만 연다.
 */
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

// ★이 폴더(site/)만 복사해 어디서든 돌게 — Flowsmith 저장소의 코드를 불러오지 않는다(Node 24 · 의존 없음).
//  아래 셋은 Flowsmith의 것과 같은 규칙이다 — 경로 다듬기는 시험(confluence-site.test.ts)이 core와 같은지 본다

/** 경로 마디마다 파일 이름에 못 쓰는 글자를 바꾼다 — Flowsmith core safeFilePath와 같다(워크플로우가 이 이름으로 저장했다) */
export function safeFilePath(rel: string): string {
  const bytes = (x: string) => new TextEncoder().encode(x).length;
  const parts = rel.split("/").filter((p) => p.trim() !== "").map((p) => {
    let s = p.replace(/[\\:*?"<>|\u0000-\u001f]/gu, "_").replace(/\s+/gu, " ").trim().replace(/[. ]+$/u, "");
    if (s === "" || s === "." || s === "..") s = "_";
    if (bytes(s) > 180) {
      const ext = /\.[A-Za-z0-9]{1,8}$/u.exec(s)?.[0] ?? "";
      let base = s.slice(0, s.length - ext.length);
      while (bytes(base + ext) > 180) base = base.slice(0, -1);
      s = base.trimEnd() + ext;
    }
    return s;
  });
  return parts.length ? parts.join("/") : "_";
}

/** CSV — 따옴표 안의 쉼표 · 줄바꿈 · 「""」 · BOM */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.startsWith("\uFEFF") ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

/** zip — 한글 이름(UTF-8 표시) · 이미 압축된 것은 그대로 · ZIP64 없음(65,535개 · 4GB까지) */
async function writeZip(path: string, files: { name: string; full: string }[]): Promise<void> {
  if (files.length > 65_535) throw new Error(`파일이 ${files.length}개라 zip 하나에 담지 못합니다(65,535개까지)`);
  const out = createWriteStream(path);
  let offset = 0;
  const write = (b: Uint8Array) => new Promise<void>((ok, fail) => { out.write(b, (e) => (e ? fail(e) : ok())); offset += b.length; });
  const central: Buffer[] = [];
  try {
    for (const f of files) {
      const data = readFileSync(f.full);
      const packed = /\.(pdf|png|jpe?g|gif|webp|zip|gz|mp4|mov|docx|xlsx|pptx)$/iu.test(f.name) ? null : deflateRawSync(data);
      const payload = packed && packed.length < data.length ? packed : data;
      const method = payload === data ? 0 : 8;
      if (offset + payload.length > 0xffff_ffff) throw new Error("4GB를 넘어 zip 하나에 담지 못합니다");
      const name = Buffer.from(f.name, "utf8");
      const d = statSync(f.full).mtime;
      const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
      const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      const crc = crc32(data) >>> 0;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14); local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
      const at = offset;
      await write(local); await write(name); await write(payload);
      const cen = Buffer.alloc(46);
      cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(method, 10); cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14);
      cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(payload.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(at, 42);
      central.push(cen, name);
    }
    const cdAt = offset;
    for (const b of central) await write(b);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(offset - cdAt, 12); end.writeUInt32LE(cdAt, 16);
    await write(end);
  } finally {
    await new Promise<void>((ok) => out.end(ok));
  }
}

/** 이 스크립트가 만든 사이트라는 표시 — 다시 만들 때 이것이 있는 폴더만 비운다 */
const MARK = ".confluence-site";

/**
 * 출력 폴더를 비워도 되나 — ★입력과 같거나 서로 안에 있으면 · 이 스크립트가 만든 사이트가 아닌데 비어 있지 않으면 멈춘다
 * (입력과 출력을 같은 폴더로 주면 수집한 것을 지운다)
 */
export function checkOut(inDir: string, outDir: string): void {
  const a = resolve(inDir) + sep;
  const b = resolve(outDir) + sep;
  if (a === b) throw new Error(`입력과 출력이 같은 폴더입니다(${resolve(inDir)}) — 사이트는 다른 폴더에 만듭니다. 예: node build.ts ${inDir} ./confluence-site`);
  if (b.startsWith(a)) throw new Error(`출력 폴더가 입력 폴더 안에 있습니다(${resolve(outDir)}) — 입력 밖의 폴더를 주세요`);
  if (a.startsWith(b)) throw new Error(`입력 폴더가 출력 폴더 안에 있습니다 — 출력 폴더를 비우면 입력이 지워집니다. 다른 폴더를 주세요`);
  if (existsSync(outDir) && readdirSync(outDir).length > 0 && !existsSync(join(outDir, MARK))) {
    throw new Error(`출력 폴더 ${resolve(outDir)}가 비어 있지 않습니다 — 이 스크립트가 만든 사이트가 아니라 비우지 않습니다. 빈 폴더나 없는 폴더를 주세요`);
  }
}

export interface SitePage { id: string; title: string; path: string; depth: number; site: string; src: string | null }
export interface SiteReport { pages: number; missing: string[]; assets: number; external: number; unresolved: string[]; out: string; zip: string | null }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const key = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
/** 사이트 안 상대 주소 — 마디마다 인코딩(한글 · 공백 · 괄호) */
const rel = (from: string, to: string) => posix.relative(posix.dirname(from), to).split("/").map((s) => (s === ".." || s === "." ? s : encodeURIComponent(s))).join("/") || encodeURIComponent(posix.basename(to));

/** 위키 본문 — id="main-content"인 요소를 태그 짝을 세어 꺼낸다. 없으면 body 안 · 그것도 없으면 통째로 */
export function mainContent(html: string): string {
  const at = html.search(/<([a-z0-9]+)\b[^>]*\bid=["']main-content["'][^>]*>/i);
  if (at >= 0) {
    const tag = /<([a-z0-9]+)/i.exec(html.slice(at))![1]!.toLowerCase();
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    re.lastIndex = at;
    let depth = 0;
    for (let m = re.exec(html); m; m = re.exec(html)) {
      if (m[0].endsWith("/>")) continue;
      depth += m[1] ? -1 : 1;
      if (depth === 0) return html.slice(at, m.index + m[0].length);
    }
    return html.slice(at);
  }
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return body ? body[1]! : html;
}

/** 위키 주소 → 사이트 안 경로(없으면 null) */
export function linkTarget(u: URL, byId: Map<string, SitePage>, byTitle: Map<string, SitePage>, assets: Set<string>): { site: string; kind: "page" | "asset" } | null {
  const p = u.pathname;
  const page = (x: SitePage | undefined) => (x ? { site: x.site, kind: "page" as const } : null);
  if (/\/pages\/viewpage\.action$/.test(p)) {
    const id = u.searchParams.get("pageId");
    if (id) return page(byId.get(id));
    const t = u.searchParams.get("title");
    if (t) return page(byTitle.get(key(t)));
  }
  const sp = /\/spaces\/[^/]+\/pages\/(\d+)/.exec(p);
  if (sp) return page(byId.get(sp[1]!));
  const disp = /\/display\/[^/]+\/(.+)$/.exec(p);
  if (disp) return page(byTitle.get(key(decodeURIComponent(disp[1]!.replace(/\+/g, " ")))));
  if (/^\/(download|images)\//.test(p)) {
    const at = safeFilePath(`assets${decodeURIComponent(p)}`);
    if (assets.has(at)) return { site: at, kind: "asset" };
    // 썸네일이 없으면 같은 파일의 원본(첨부)
    const full = at.replace(/^assets\/download\/thumbnails\//, "assets/download/attachments/");
    if (assets.has(full)) return { site: full, kind: "asset" };
  }
  return null;
}

/** 본문의 링크 · 그림을 다시 쓴다 — 스크립트 · on… 속성 · <base> · 위키 스타일시트는 걷어 낸다 */
export function rewrite(html: string, base: string, here: string, maps: { byId: Map<string, SitePage>; byTitle: Map<string, SitePage>; assets: Set<string> }, seen: { external: number; unresolved: Set<string> }): string {
  const origin = (() => { try { return new URL(base).origin; } catch { return ""; } })();
  const map = (raw: string): { url: string; local: boolean; out: boolean } => {
    const v = raw.replace(/&amp;/g, "&").trim();
    if (v === "" || v.startsWith("#") || /^(data|mailto|tel|javascript):/i.test(v)) return { url: raw, local: true, out: false };
    let u: URL;
    try { u = new URL(v, base); } catch { return { url: raw, local: false, out: false }; }
    if (u.origin !== origin) { seen.external++; return { url: u.href, local: false, out: true }; }
    const t = linkTarget(u, maps.byId, maps.byTitle, maps.assets);
    if (t) return { url: rel(here, t.site) + (t.kind === "page" ? u.hash : ""), local: true, out: false };
    seen.unresolved.add(u.pathname);
    return { url: u.href, local: false, out: true };
  };
  let s = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<(base|link|meta)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // 그림 — 늦게 싣는 그림(data-image-src)이면 그것을 src로
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const lazy = /\sdata-image-src=("([^"]*)"|'([^']*)')/i.exec(tag);
    let t = tag.replace(/\s(src|data-image-src|data-src)=("([^"]*)"|'([^']*)')/gi, (_m, attr: string, _q, a?: string, b?: string) => ` ${attr}="${esc(map(a ?? b ?? "").url)}"`);
    if (lazy) { const src = esc(map(lazy[2] ?? lazy[3] ?? "").url); t = /\ssrc=/i.test(t) ? t.replace(/\ssrc="[^"]*"/i, ` src="${src}"`) : t.replace(/^<img/i, `<img src="${src}"`); }
    return t.replace(/\ssrcset=("[^"]*"|'[^']*')/gi, "");
  });
  // 링크 — 사이트 밖(위키 · 외부)은 새 창으로
  s = s.replace(/<a\b[^>]*>/gi, (tag) => {
    let out = false;
    const t = tag.replace(/\shref=("([^"]*)"|'([^']*)')/i, (_m, _q, a?: string, b?: string) => { const r = map(a ?? b ?? ""); out = r.out; return ` href="${esc(r.url)}"`; });
    return out && !/\starget=/i.test(t) ? t.replace(/^<a/i, '<a target="_blank" rel="noopener" class="out"') : t;
  });
  return s;
}

const text = (html: string) => html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

function walk(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const full = join(dir, n);
    return statSync(full).isDirectory() ? walk(full, `${prefix}${n}/`) : [`${prefix}${n}`];
  });
}

function page(p: SitePage, here: string, body: string, crumbs: SitePage[], siteTitle: string, wiki: string, stamp: string): string {
  const root = rel(here, "index.html").replace(/index\.html$/, "");
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)} · ${esc(siteTitle)}</title><link rel="stylesheet" href="${root}style.css"></head>
<body data-root="${esc(root)}" data-page="${esc(p.site)}">
<header class="top"><a class="brand" href="${root}index.html">${esc(siteTitle)}</a><input id="q" type="search" placeholder="검색 — 제목 · 본문" autocomplete="off"><div id="hits" hidden></div></header>
<div class="layout"><nav id="tree" aria-label="페이지 트리"></nav>
<main><div class="crumbs">${crumbs.map((c) => `<a href="${esc(rel(here, c.site))}">${esc(c.title)}</a>`).join(" › ")}</div>
<h1>${esc(p.title)}</h1>
<article class="wiki">${body}</article>
<footer>원본: ${wiki ? `<a class="out" target="_blank" rel="noopener" href="${esc(`${wiki}/pages/viewpage.action?pageId=${p.id}`)}">위키에서 보기</a> · ` : ""}수집 ${esc(stamp)} · 사내 자료 — 밖으로 내보내지 마세요</footer></main></div>
<script src="${root}site-data.js"></script><script src="${root}app.js"></script>
</body></html>
`;
}

export async function buildSite(inDir: string, outDir: string, opts: { zip?: boolean; title?: string } = {}): Promise<SiteReport> {
  const csvPath = join(inDir, "pages.csv");
  if (!existsSync(csvPath)) throw new Error(`${csvPath}가 없습니다 — confluence-html 워크플로우의 결과 폴더(또는 zip을 푼 것)를 주세요`);
  const [head, ...rows] = parseCsv(readFileSync(csvPath, "utf8")).filter((r) => r.length > 1);
  const col = (n: string) => head!.indexOf(n);
  const pages: SitePage[] = rows.map((r) => {
    const path = r[col("path")]!;
    const src = join(inDir, "html", `${safeFilePath(path)}.html`);
    return { id: r[col("id")]!, title: r[col("title")]!, path, depth: Number(r[col("depth")] ?? 0), site: `pages/${safeFilePath(path)}.html`, src: existsSync(src) ? src : null };
  });
  if (pages.length === 0) throw new Error("pages.csv에 페이지가 없습니다");
  checkOut(inDir, outDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, MARK), "confluence/site/build.ts가 만든 사이트 — 다시 만들면 이 폴더를 비우고 새로 씁니다\n");
  // 그림 · 첨부 — 그대로 옮긴다
  const assetList = walk(join(inDir, "assets")).map((a) => `assets/${a}`);
  if (assetList.length) cpSync(join(inDir, "assets"), join(outDir, "assets"), { recursive: true });
  const maps = { byId: new Map(pages.map((p) => [p.id, p])), byTitle: new Map(pages.map((p) => [key(p.title), p])), assets: new Set(assetList) };
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const siteTitle = opts.title ?? pages[0]!.title;
  const seen = { external: 0, unresolved: new Set<string>() };
  const search: { t: string; p: string; x: string }[] = [];
  const missing: string[] = [];
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  let wiki = "";
  for (const p of pages) {
    const none = `<p class="missing">이 페이지는 받지 못했습니다 — 수집 결과(result.csv)의 까닭을 보세요.</p>`;
    let body = none;
    // 첫 페이지는 index.html로도 — 그 자리 기준으로 다시 쓴다
    let render = (_here: string) => none;
    if (p.src) {
      const html = readFileSync(p.src, "utf8");
      const base = /<base\s+href="([^"]+)"/i.exec(html)?.[1]?.replace(/&amp;/g, "&") ?? "";
      if (!wiki && base) { try { wiki = new URL(base).origin; } catch { /* 주소 없음 */ } }
      const main = mainContent(html);
      render = (here) => rewrite(main, base, here, maps, here === p.site ? seen : { external: 0, unresolved: new Set() });
      body = render(p.site);
    } else missing.push(p.path);
    // 경로 — 조상들(트리 경로의 앞마디)
    const parts = p.path.split("/");
    const crumbs = parts.slice(0, -1).map((_, i) => byPath.get(parts.slice(0, i + 1).join("/"))).filter((x): x is SitePage => !!x);
    const out = join(outDir, ...p.site.split("/"));
    mkdirSync(join(out, ".."), { recursive: true });
    writeFileSync(out, page(p, p.site, body, crumbs, siteTitle, wiki, stamp));
    if (p === pages[0]) writeFileSync(join(outDir, "index.html"), page(p, "index.html", render("index.html"), [], siteTitle, wiki, stamp));
    search.push({ t: p.title, p: p.site, x: text(body).slice(0, 4000) });
  }
  writeFileSync(join(outDir, "site-data.js"), `window.SITE=${JSON.stringify({ title: siteTitle, pages: pages.map((p) => ({ t: p.title, p: p.site, d: p.depth })) })};\n`);
  writeFileSync(join(outDir, "search-data.js"), `window.SEARCH=${JSON.stringify(search)};\n`);
  cpSync(join(import.meta.dirname, "app.js"), join(outDir, "app.js"));
  cpSync(join(import.meta.dirname, "style.css"), join(outDir, "style.css"));
  let zip: string | null = null;
  if (opts.zip) {
    zip = `${resolve(outDir)}.zip`;
    const files = walk(outDir).filter((f) => f !== MARK).sort();
    await writeZip(zip, files.map((f) => ({ name: f, full: join(outDir, f) })));
  }
  return { pages: pages.length, missing, assets: assetList.length, external: seen.external, unresolved: [...seen.unresolved].sort(), out: resolve(outDir), zip };
}

// 명령으로 부르면
// ★실제 경로로 견준다 — macOS의 /var → /private/var처럼 링크를 거친 경로여도
const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(import.meta.filename)) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (args.length < 2) { console.error("쓰는 법: node build.ts <수집 폴더(zip을 푼 것)> <사이트 폴더(다른 폴더)> [--zip]"); process.exit(2); }
  const r = await buildSite(args[0]!, args[1]!, { zip: process.argv.includes("--zip") }).catch((e: Error) => { console.error(`멈췄습니다 — ${e.message}`); process.exit(1); });
  console.log(`페이지 ${r.pages}쪽(받지 못함 ${r.missing.length}) · 그림 · 첨부 ${r.assets}개 → ${relative(process.cwd(), r.out) || r.out}${sep}index.html`);
  if (r.zip) console.log(`zip: ${r.zip}`);
  if (r.unresolved.length) console.log(`사이트에 없는 위키 주소 ${r.unresolved.length}곳은 원래 주소로 남겼습니다(로그인한 브라우저에서만 열림) — 예: ${r.unresolved.slice(0, 5).join(" · ")}`);
}
