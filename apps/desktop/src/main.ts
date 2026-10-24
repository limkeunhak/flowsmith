/**
 * **Flowsmith 데스크톱 앱**(PLAN §44 · docs/DESKTOP.md) — 2단계: 로컬 모드.
 *
 *   이 PC의 서버 · 워커를 앱이 띄우고(utilityProcess — Electron의 Node 24로 `.ts`를 그대로) 편집 화면을 창에 연다.
 *   서버는 127.0.0.1의 빈 포트 · 로그인 꺼짐(이 PC에서 혼자 쓰는 모드) — 지금의 standalone 서버와 같다.
 *
 *   데이터      %APPDATA%\Flowsmith\data            DB · 저장 파일 · 플러그인
 *   마스터 키   %APPDATA%\Flowsmith\master.key.enc   ★Windows 사용자 암호화(DPAPI — safeStorage)로 잠근다 · 서버에는 환경변수로만
 *   브라우저    %LOCALAPPDATA%\Flowsmith\browsers    Playwright Chromium — 처음 켤 때 받는다(설치본에 넣지 않는다)
 *   지갑        %LOCALAPPDATA%\Flowsmith\{mm,w}      MetaMask · 지갑 프로필(worker metamask.ts) — ★짧은 경로(260자)
 *
 * 띄우는 브라우저는 창 없이(실행 화면 보기로 본다) · 지갑 브라우저만 창을 띄운다(FLOWSMITH_WALLET_BROWSER=on).
 * 앱 안 브라우저(WebContentsView · 3단계)와 회사 서버 모드(4단계)는 아직.
 */
import { app, BrowserWindow, dialog, Menu, safeStorage, shell, utilityProcess, type UtilityProcess } from "electron";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

app.setName("Flowsmith");
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
let server: UtilityProcess | null = null;
let serverUrl: string | null = null;
let quitting = false;

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

function startServer(key: string): Promise<string> {
  return new Promise((ok, fail) => {
    mkdirSync(dataDir, { recursive: true });
    const env: Record<string, string> = { ...(process.env as Record<string, string>), FLOWSMITH_APP_ROOT: appRoot, FLOWSMITH_MASTER_KEY: key, FLOWSMITH_WALLET_BROWSER: "on" };
    delete env["ELECTRON_RUN_AS_NODE"];
    delete env["FLOWSMITH_MASTER_KEY_FILE"];
    if (browsersDir) env["PLAYWRIGHT_BROWSERS_PATH"] = browsersDir;
    const p = utilityProcess.fork(join(appRoot, "apps", "desktop", "src", "boot.ts"), ["--port", "0", "--data", dataDir], { stdio: "pipe", serviceName: "Flowsmith 서버", env });
    server = p;
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

// ─── 창 ────────────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1440, height: 920, minWidth: 960, minHeight: 600, title: "Flowsmith", show: false, backgroundColor: "#f6f7fb",
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  w.once("ready-to-show", () => w.show());
  // 새 창 — 이 서버의 화면은 앱 창으로 · 밖의 주소는 기본 브라우저로
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (serverUrl && url.startsWith(serverUrl)) return { action: "allow" };
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // 편집 화면 밖으로 옮겨 가지 않는다(링크는 기본 브라우저로)
  w.webContents.on("will-navigate", (e, url) => { if (serverUrl && !url.startsWith(serverUrl) && /^https?:\/\//.test(url)) { e.preventDefault(); void shell.openExternal(url); } });
  return w;
}

async function boot(): Promise<void> {
  Menu.setApplicationMenu(null);
  win = createWindow();
  win.on("closed", () => { win = null; });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH)}`);
  try {
    if (browsersDir && needBrowsers(browsersDir)) {
      status("처음 켜는 것이라 브라우저(Chromium)를 받습니다 — 몇 분 걸릴 수 있습니다");
      await installBrowsers(browsersDir);
    }
    status("서버를 켜는 중…");
    serverUrl = await startServer(masterKey());
    log(`서버: ${serverUrl}`);
    await win?.loadURL(serverUrl);
  } catch (e) {
    status((e as Error).message, true);
    log(`시작 실패: ${(e as Error).message}`);
  }
}

// 한 번만 — 두 번째로 켜면 있는 창을 앞으로
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(boot, (e) => log(`whenReady: ${String(e)}`));
  app.on("window-all-closed", () => app.quit());
  // 끄기 — 서버에 «stop»을 보내 DB를 닫게 하고(5초) 그래도 안 꺼지면 끝낸다
  app.on("before-quit", (e) => {
    log(`끄는 중(서버 ${server ? "있음" : "없음"})`);
    if (!server || quitting) return;
    e.preventDefault();
    quitting = true;
    const p = server;
    const force = setTimeout(() => { log("서버가 5초 안에 꺼지지 않아 끝냅니다"); p.kill(); app.exit(0); }, 5_000);
    p.once("exit", () => { clearTimeout(force); log("서버가 꺼졌습니다"); app.exit(0); });
    p.postMessage("stop");
  });
}
