/**
 * **Flowsmith 데스크톱 앱**(PLAN §44 · docs/DESKTOP.md) — 2단계: 로컬 모드 · 3단계: 앱 안 브라우저 · 4단계: 회사 서버 모드.
 *
 *   처음 켤 때 고른다(connect.ts) — «이 PC에서만» · «회사 서버에 붙기»(서버 주소 + 관리자가 준 워커 토큰 — 한 번만).
 *   로컬 모드: 이 PC의 서버 · 워커를 앱이 띄우고(utilityProcess — Electron의 Node 24로 `.ts`를 그대로) 편집 화면을 창에 연다.
 *     서버는 127.0.0.1의 빈 포트 · 로그인 꺼짐(이 PC에서 혼자 쓰는 모드) — 지금의 standalone 서버와 같다.
 *   회사 서버 모드: 이 PC의 서버는 띄우지 않는다 — 회사 서버의 편집 화면을 창에 열고, 이 PC는 그 서버의 개인 워커로 붙는다(agent.ts).
 *     «내 PC에서 실행하기»로 온 실행이 이 PC의 앱 안 브라우저(실행 창) · 지갑 브라우저에서 돈다.
 *
 *   데이터      %APPDATA%\Flowsmith\data            DB · 저장 파일 · 플러그인
 *   마스터 키   %APPDATA%\Flowsmith\master.key.enc   ★Windows 사용자 암호화(DPAPI — safeStorage)로 잠근다 · 서버에는 환경변수로만
 *   브라우저    %LOCALAPPDATA%\Flowsmith\browsers    Playwright Chromium — 처음 켤 때 받는다(설치본에 넣지 않는다)
 *   지갑        %LOCALAPPDATA%\Flowsmith\{mm,w}      MetaMask · 지갑 프로필(worker metamask.ts) — ★짧은 경로(260자)
 *
 * 띄우는 브라우저는 창 없이(실행 화면 보기로 본다) · 지갑 브라우저만 창을 띄운다(FLOWSMITH_WALLET_BROWSER=on).
 * 앱 안 브라우저(browser: app) — 워커가 부탁하면 WebContentsView를 열고(views.ts), 워커는 이 앱의 CDP로 붙는다(FLOWSMITH_APP_CDP).
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell, utilityProcess, type UtilityProcess } from "electron";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Views } from "./views.ts";
import { Connection, originOf, serverProblem, setupPage, type Mode } from "./connect.ts";

app.setName("Flowsmith");
// 앱 안 브라우저 — 워커가 CDP로 뷰에 붙는다. ★127.0.0.1의 임의 포트(번호는 userData/DevToolsActivePort) ·
//  --remote-allow-origins는 주지 않는다(웹 페이지 출처의 접속은 크롬이 늘 거절한다 — DESKTOP.md §4 · §9-③)
app.commandLine.appendSwitch("remote-debugging-port", "0");
// WSL(WSLg)에서 개발할 때만 — 렌더러가 /dev/shm · /tmp를 못 본다(0단계 · Electron 실험)
if (process.env["FLOWSMITH_DESKTOP_WSL"] === "1") for (const s of ["no-sandbox", "disable-dev-shm-usage", "no-zygote"]) app.commandLine.appendSwitch(s);

/** 저장소(개발) · 설치본의 뿌리 — packages/ · apps/studio/dist · node_modules가 여기에 */
const appRoot = app.isPackaged ? app.getAppPath() : resolve(app.getAppPath(), "..", "..");
const userDir = app.getPath("userData");
const dataDir = join(userDir, "data");
const logDir = join(userDir, "logs");
/** 짧은 경로 — Windows 260자(지갑 프로필 · 브라우저) */
const localRoot = process.platform === "win32" ? join(process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"), "Flowsmith") : join(homedir(), ".cache", "flowsmith");
/** 설치본만 따로 받는다 — 개발에서는 pnpm이 받아 둔 Playwright 브라우저를 그대로 쓴다 */
const browsersDir = app.isPackaged ? join(localRoot, "browsers") : null;

let win: BrowserWindow | null = null;
/** 이 앱이 띄운 것 — 로컬 모드면 서버 · 회사 서버 모드면 워커(agent.ts) */
let server: UtilityProcess | null = null;
const conn = new Connection(userDir);
let serverUrl: string | null = null;
let quitting = false;
const views = new Views(() => win, (t) => log(t));

const log = (text: string) => { try { mkdirSync(logDir, { recursive: true }); appendFileSync(join(logDir, "desktop.log"), `${new Date().toISOString()} ${text}\n`); } catch { /* 로그는 실패해도 된다 */ } };

// ─── 시작 화면 ─────────────────────────────────────────────────────

const SPLASH = `<!doctype html><meta charset="utf-8"><title>Flowsmith</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;font-family:"Segoe UI","Malgun Gothic",sans-serif;background:#f6f7fb;color:#1f2430}
.box{width:520px}h1{font-size:22px;margin:0 0 6px}#s{color:#5b6475;font-size:14px;min-height:20px}
#l{margin-top:14px;font:12px/1.5 Consolas,monospace;color:#7a8394;white-space:pre-wrap;max-height:180px;overflow:hidden}
.err #s{color:#c0392b}</style>
<div class="box"><h1>Flowsmith</h1><div id="s">켜는 중…</div><div id="l"></div></div>
<script>window.status_=(s,err)=>{document.getElementById("s").textContent=s;document.body.className=err?"err":""};
window.line_=(t)=>{const l=document.getElementById("l");l.textContent=(l.textContent+"\\n"+t).split("\\n").slice(-10).join("\\n")}</script>`;

const status = (text: string, err = false) => { void win?.webContents.executeJavaScript(`window.status_ && status_(${JSON.stringify(text)}, ${err})`).catch(() => undefined); log(text); };
const line = (text: string) => { const t = text.trim(); if (t) void win?.webContents.executeJavaScript(`window.line_ && line_(${JSON.stringify(t.slice(0, 200))})`).catch(() => undefined); };

// ─── 마스터 키 ─────────────────────────────────────────────────────

/** 처음이면 만든다 — Windows 사용자 암호화로 잠가 둔다(그 사용자만 풀 수 있다). 암호화가 없으면(일부 리눅스) 권한 600 파일로 */
function masterKey(): string {
  mkdirSync(userDir, { recursive: true });
  const enc = join(userDir, "master.key.enc");
  const plain = join(userDir, "master.key");
  const can = safeStorage.isEncryptionAvailable();
  if (can && existsSync(enc)) return safeStorage.decryptString(readFileSync(enc));
  if (existsSync(plain)) return readFileSync(plain, "utf8").trim();
  const key = randomBytes(32).toString("base64");
  if (can) writeFileSync(enc, safeStorage.encryptString(key));
  else { writeFileSync(plain, `${key}\n`, { mode: 0o600 }); log("safeStorage를 쓸 수 없어 마스터 키를 파일(권한 600)로 둡니다"); }
  return key;
}

// ─── Playwright 브라우저(설치본만) ───────────────────────────────────

/**
 * 이 Playwright가 쓰는 Chromium 판이 다 깔렸나 — playwright-core/browsers.json.
 * ★폴더가 아니라 Playwright가 다 푼 뒤 남기는 표시(INSTALLATION_COMPLETE)를 본다 — 폴더는 풀기 시작할 때 생긴다
 *  (폴더만 보고 끊으면 반쯤 풀린 실행 파일이 남아 «spawn EFTYPE»으로 뜨지 않는다 — 2단계 설치본 확인에서 겪었다)
 */
function needBrowsers(dir: string): boolean {
  try {
    const list = (JSON.parse(readFileSync(join(appRoot, "node_modules", "playwright-core", "browsers.json"), "utf8")) as { browsers: { name: string; revision: string }[] }).browsers;
    const want = list.filter((b) => b.name === "chromium" || b.name === "chromium-headless-shell").map((b) => `${b.name.replace(/-/g, "_")}-${b.revision}`);
    return want.some((w) => !existsSync(join(dir, w, "INSTALLATION_COMPLETE"))) || existsSync(join(dir, "__dirlock"));
  } catch { return true; }
}

/**
 * Playwright의 «install chromium»을 돌린다. ★utilityProcess 안에서는 다 받고도 끝나지 않을 때가 있다(부모와의 통로가 살아 있다) —
 * 끝 신호를 기다리지 않고, 브라우저 폴더가 다 갖춰지고 2초 조용하면 끝낸다
 */
function installBrowsers(dir: string): Promise<void> {
  return new Promise((ok, fail) => {
    const p = utilityProcess.fork(join(appRoot, "node_modules", "playwright", "cli.js"), ["install", "chromium"], {
      stdio: "pipe", serviceName: "Flowsmith 브라우저 받기", env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: dir },
    });
    let last = Date.now();
    let done = false;
    const finish = (err?: Error) => { if (done) return; done = true; clearInterval(poll); p.kill(); if (err) fail(err); else ok(); };
    const out = (d: unknown) => { last = Date.now(); for (const t of String(d).split(/[\r\n]+/)) { line(t); if (t.trim() && !/^\|/.test(t.trim())) log(`[브라우저] ${t.trim()}`); } };
    p.stdout?.on("data", out);
    p.stderr?.on("data", out);
    const poll = setInterval(() => { if (!needBrowsers(dir) && Date.now() - last > 2_000) finish(); }, 1_000);
    p.on("exit", (code) => (needBrowsers(dir) ? finish(new Error(`브라우저를 받지 못했습니다(끝 코드 ${code}) — 인터넷 연결을 확인하세요`)) : finish()));
  });
}

// ─── 서버 ──────────────────────────────────────────────────────────

/** 이 앱의 CDP 주소 — 크롬이 켜지며 userData/DevToolsActivePort에 적는다(첫 줄이 포트). 못 읽으면 앱 안 브라우저 없이 간다 */
async function cdpUrl(): Promise<string | null> {
  const file = join(userDir, "DevToolsActivePort");
  for (let i = 0; i < 50; i++) {
    try { const port = readFileSync(file, "utf8").split(/\r?\n/)[0]?.trim(); if (port && /^\d+$/.test(port)) return `http://127.0.0.1:${port}`; } catch { /* 아직 */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  log("CDP 포트를 읽지 못했습니다 — 앱 안 브라우저 없이 켭니다");
  return null;
}

function startServer(key: string, cdp: string | null): Promise<string> {
  return new Promise((ok, fail) => {
    mkdirSync(dataDir, { recursive: true });
    const env: Record<string, string> = { ...(process.env as Record<string, string>), FLOWSMITH_APP_ROOT: appRoot, FLOWSMITH_MASTER_KEY: key, FLOWSMITH_WALLET_BROWSER: "on", ...(cdp ? { FLOWSMITH_APP_CDP: cdp } : {}) };
    delete env["ELECTRON_RUN_AS_NODE"];
    delete env["FLOWSMITH_MASTER_KEY_FILE"];
    if (browsersDir) env["PLAYWRIGHT_BROWSERS_PATH"] = browsersDir;
    const p = utilityProcess.fork(join(appRoot, "apps", "desktop", "src", "boot.ts"), ["--port", "0", "--data", dataDir], { stdio: "pipe", serviceName: "Flowsmith 서버", env });
    server = p;
    views.serve(p);
    const tail: string[] = [];
    const keep = (d: unknown) => { const s = String(d); log(`[서버] ${s.trimEnd()}`); tail.push(...s.split(/\r?\n/).filter(Boolean)); tail.splice(0, Math.max(0, tail.length - 12)); };
    p.stdout?.on("data", keep);
    p.stderr?.on("data", keep);
    const timer = setTimeout(() => fail(new Error(`서버가 60초 안에 뜨지 않았습니다\n${tail.join("\n")}`)), 60_000);
    p.on("message", (m: { t?: string; url?: string }) => { if (m?.t === "ready" && m.url) { clearTimeout(timer); ok(m.url); } });
    p.on("exit", (code) => {
      clearTimeout(timer);
      server = null;
      if (quitting) return;
      if (!serverUrl) { fail(new Error(`서버가 멈췄습니다(끝 코드 ${code})\n${tail.join("\n")}`)); return; }
      dialog.showErrorBox("Flowsmith", `서버가 멈췄습니다(끝 코드 ${code}) — 앱을 다시 켜세요.\n\n${tail.join("\n")}`);
    });
  });
}


// ─── 회사 서버의 워커(4단계) ─────────────────────────────────────────

/** 회사 서버 모드의 이 PC — 워커 상태(agent.ts가 알린다). 편집 화면이 «내 PC에서 실행하기»에 쓴다 */
let agentInfo: { state: string; id: string | null; name: string | null; message: string | null } | null = null;

/** 워커를 띄운다 — 처음 받아들여지거나(online) 거절될(denied) 때까지 기다린다(20초 — 서버가 안 닿으면 offline 그대로 간다) */
function startAgent(origin: string, token: string, cdp: string | null): Promise<string> {
  return new Promise((ok) => {
    mkdirSync(dataDir, { recursive: true });
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>), FLOWSMITH_APP_ROOT: appRoot, FLOWSMITH_BOOT: "agent", FLOWSMITH_SERVER: origin, FLOWSMITH_WORKER_TOKEN: token, FLOWSMITH_DATA: dataDir,
      ...(cdp ? { FLOWSMITH_APP_CDP: cdp } : {}),
    };
    delete env["ELECTRON_RUN_AS_NODE"];
    if (browsersDir) env["PLAYWRIGHT_BROWSERS_PATH"] = browsersDir;
    const p = utilityProcess.fork(join(appRoot, "apps", "desktop", "src", "boot.ts"), [], { stdio: "pipe", serviceName: "Flowsmith 워커", env });
    server = p;
    views.serve(p);
    const keep = (d: unknown) => log(`[워커] ${String(d).trimEnd()}`);
    p.stdout?.on("data", keep);
    p.stderr?.on("data", keep);
    let settled = false;
    const settle = (state: string) => { if (!settled) { settled = true; clearTimeout(timer); ok(state); } };
    const timer = setTimeout(() => settle(agentInfo?.state ?? "offline"), 20_000);
    p.on("message", (m: { t?: string; state?: string; id?: string | null; name?: string | null; message?: string | null }) => {
      if (m?.t !== "agent" || typeof m.state !== "string") return;
      if (m.state !== agentInfo?.state) log(`워커 상태: ${m.state}${m.name ? ` («${m.name}»)` : ""}${m.message ? ` — ${m.message}` : ""}`);
      const was = agentInfo?.state;
      agentInfo = { state: m.state, id: m.id ?? null, name: m.name ?? null, message: m.message ?? null };
      // 쓰는 도중에 거절됐다(관리자가 토큰을 바꿈 · 지움) — 처음 화면을 다시 열어 새 토큰을 받는다
      if (settled && m.state === "denied" && was !== "denied") void showSetup(`${m.message ?? "서버가 이 PC를 받지 않습니다"}\n관리자에게 새 토큰을 받아 넣으세요.`);
      if (m.state === "online" || m.state === "denied") settle(m.state);
    });
    p.on("exit", (code) => {
      server = null;
      if (quitting) return;
      agentInfo = { state: "closed", id: null, name: null, message: `워커가 멈췄습니다(끝 코드 ${code})` };
      settle("closed");
    });
  });
}

// ─── 창 ────────────────────────────────────────────────────────────

/** 지금 어떻게 켜졌나 — local · server(회사 서버) */
let mode: Mode | null = null;

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1440, height: 920, minWidth: 960, minHeight: 600, title: "Flowsmith", show: false, backgroundColor: "#f6f7fb",
    // preload — 데스크톱 앱이라는 것 · 녹화 뷰를 놓는 길 · 연결 정보 · 처음 화면의 답만(preload.cjs)
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)) },
  });
  w.once("ready-to-show", () => w.show());
  // 새 창 — 이 서버의 화면은 앱 창으로 · 밖의 주소는 기본 브라우저로
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (serverUrl && url.startsWith(serverUrl)) return { action: "allow" };
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // 편집 화면 밖으로 옮겨 가지 않는다(링크는 기본 브라우저로) — ★회사 서버 모드는 그대로 둔다(회사 로그인이 다른 주소를 거쳐 돌아온다)
  w.webContents.on("will-navigate", (e, url) => {
    if (mode?.mode === "server") return;
    if (serverUrl && !url.startsWith(serverUrl) && /^https?:\/\//.test(url)) { e.preventDefault(); void shell.openExternal(url); }
  });
  return w;
}

const showSetup = async (error: string | null = null) => { await win?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(setupPage(conn.read(), error))}`); };

/** 이 PC에서만 — 서버 · 워커를 이 PC에 */
async function startLocal(): Promise<void> {
  if (browsersDir && needBrowsers(browsersDir)) {
    status("처음 켜는 것이라 브라우저(Chromium)를 받습니다 — 몇 분 걸릴 수 있습니다");
    await installBrowsers(browsersDir);
  }
  status("서버를 켜는 중…");
  serverUrl = await startServer(masterKey(), await cdpUrl());
  log(`서버: ${serverUrl}`);
  await win?.loadURL(serverUrl);
}

/** 회사 서버에 붙기 — 이 PC는 워커로 붙고 편집 화면은 회사 서버의 것을 연다 */
async function startCompany(origin: string): Promise<void> {
  const token = conn.token();
  if (!token) { await showSetup("워커 토큰이 없습니다 — 관리자에게 받은 토큰을 넣으세요"); return; }
  if (browsersDir && needBrowsers(browsersDir)) {
    status("처음 켜는 것이라 브라우저(Chromium)를 받습니다 — 몇 분 걸릴 수 있습니다");
    await installBrowsers(browsersDir);
  }
  status(`회사 서버(${origin})에 붙는 중…`);
  const state = await startAgent(origin, token, await cdpUrl());
  if (state === "denied") {
    const why = agentInfo?.message ?? "서버가 이 PC를 받지 않습니다";
    server?.postMessage("stop");
    await showSetup(`${why}\n관리자에게 새 토큰을 받아 넣으세요.`);
    return;
  }
  if (state !== "online") log(`워커가 아직 붙지 못했습니다(${state}) — 편집 화면을 먼저 엽니다. 워커는 계속 붙어 봅니다`);
  serverUrl = origin;
  await win?.loadURL(origin);
}

async function boot(): Promise<void> {
  // ★macOS는 메뉴가 없으면 ⌘C · ⌘V · ⌘A · ⌘Q가 먹지 않는다 — 기본 메뉴(앱 · 편집 · 창)만 둔다. Windows는 메뉴 없이
  Menu.setApplicationMenu(process.platform === "darwin" ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]) : null);
  win = createWindow();
  win.on("closed", () => { win = null; });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH)}`);
  mode = conn.read();
  // 3단계까지 쓰던 PC(이 PC의 데이터가 있다) — 묻지 않고 로컬 모드로 이어 간다
  if (!mode && existsSync(join(dataDir, "flowsmith.db"))) { conn.save({ mode: "local" }); mode = { mode: "local" }; }
  try {
    if (!mode) await showSetup();
    else if (mode.mode === "local") await startLocal();
    else await startCompany(mode.server);
  } catch (e) {
    status((e as Error).message, true);
    log(`시작 실패: ${(e as Error).message}`);
  }
}

/** 처음 화면의 답 — 고른 것을 남기고 켠다. 이미 무언가 돌고 있으면(연결 바꾸기) 앱을 다시 켠다 */
async function chooseMode(c: { mode?: unknown; server?: unknown; token?: unknown }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (c.mode === "local") conn.save({ mode: "local" });
  else if (c.mode === "server") {
    const raw = typeof c.server === "string" ? c.server.trim() : "";
    const bad = serverProblem(raw);
    if (bad) return { ok: false, error: bad };
    const token = typeof c.token === "string" ? c.token.trim() : "";
    if (token && !/^fsw_[A-Za-z0-9_-]{10,}$/.test(token)) return { ok: false, error: "워커 토큰은 fsw_로 시작합니다 — 관리자에게 받은 것을 그대로 넣으세요" };
    if (!token && !conn.token()) return { ok: false, error: "워커 토큰을 넣으세요 — 관리자가 «워커» 화면에서 만들어 줍니다" };
    conn.save({ mode: "server", server: originOf(raw) }, token || undefined);
  } else return { ok: false, error: "어떻게 쓸지 고르세요" };
  log(`연결: ${c.mode === "server" ? `회사 서버 ${originOf(String(c.server))}` : "이 PC에서만"}`);
  if (server) { relaunch(); return { ok: true }; }
  mode = conn.read();
  status("켜는 중…");
  await win?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH)}`);
  try { if (mode?.mode === "local") await startLocal(); else if (mode?.mode === "server") await startCompany(mode.server); }
  catch (e) { status((e as Error).message, true); }
  return { ok: true };
}

/** 앱을 다시 켠다 — 돌던 서버 · 워커를 먼저 끈다(before-quit) */
function relaunch(): void {
  app.relaunch();
  app.quit();
}

// 편집 화면 · 처음 화면이 묻는 것(preload.cjs)
ipcMain.handle("fs:desktop", () => ({
  version: 1,
  mode: mode?.mode ?? null,
  server: mode?.mode === "server" ? mode.server : null,
  worker: mode?.mode === "server" ? agentInfo : null,
}));
// ★처음 화면(data:)에서만 — 회사 서버의 페이지가 연결을 바꾸지 못하게
ipcMain.handle("fs:setup", (e, c: unknown) => (e.senderFrame?.url.startsWith("data:") ? chooseMode((c ?? {}) as Record<string, unknown>) : { ok: false, error: "여기서는 바꿀 수 없습니다" }));
ipcMain.on("fs:open-setup", (e) => { if (e.sender === win?.webContents) void showSetup(); });

// 한 번만 — 두 번째로 켜면 있는 창을 앞으로
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(boot, (e) => log(`whenReady: ${String(e)}`));
  // 창을 닫으면 끝 — macOS도(앱이 서버 · 워커를 쥐고 있어 남겨 두지 않는다 · 다시 켜면 그대로 이어진다)
  app.on("window-all-closed", () => app.quit());
  // 끄기 — 서버(또는 워커)에 «stop»을 보내 정리하게 하고(5초) 그래도 안 꺼지면 끝낸다
  app.on("before-quit", (e) => {
    log(`끄는 중(${mode?.mode === "server" ? "워커" : "서버"} ${server ? "있음" : "없음"})`);
    if (!server || quitting) return;
    e.preventDefault();
    quitting = true;
    const p = server;
    const force = setTimeout(() => { log("5초 안에 꺼지지 않아 끝냅니다"); p.kill(); app.exit(0); }, 5_000);
    p.once("exit", () => { clearTimeout(force); log("서버가 꺼졌습니다"); app.exit(0); });
    p.postMessage("stop");
  });
}
