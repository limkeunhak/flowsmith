/**
 * **만든 앱을 켜 본다**(5단계 · macOS를 Mac에서 · CI에서) — 앱 실행 파일 하나를 받아:
 *
 *   node apps/desktop/scripts/smoke.ts <앱 실행 파일> [<캡쳐 폴더>]
 *     macOS: dist/mac-arm64/Flowsmith.app/Contents/MacOS/Flowsmith · Windows: Flowsmith.exe
 *
 *   새 사용자 폴더에 «이 PC에서만»을 미리 적어 두고 켠다 → (처음이면 브라우저를 받고) 서버가 뜰 때까지 →
 *   편집 화면 200 · 띄우기 실행(example 읽기) · 앱 안 브라우저 실행(실행 창) → 편집 화면 캡쳐 → 끈다.
 *   하나라도 안 되면 끝 코드 1. ★인터넷이 있어야 한다(브라우저 받기 · iana.org)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const exe = process.argv[2];
const out = process.argv[3] ?? join(tmpdir(), "flowsmith-smoke");
if (!exe || !existsSync(exe)) { console.error(`앱 실행 파일이 없습니다: ${exe ?? "(안 줌)"}`); process.exit(2); }
mkdirSync(out, { recursive: true });
const repo = fileURLToPath(new URL("../../../", import.meta.url));
// Playwright는 엔진의 것을 빌린다(이 패키지는 싣지 않는다) — 쓰는 만큼만 꼴을 적는다
interface SmokePage { url(): string; goto(u: string): Promise<unknown>; waitForTimeout(ms: number): Promise<void>; screenshot(o: { path: string; timeout: number }): Promise<unknown> }
interface SmokeBrowser { contexts(): { pages(): SmokePage[] }[]; close(): Promise<void> }
const { chromium } = createRequire(join(repo, "packages", "engine", "package.json"))("playwright") as { chromium: { connectOverCDP(url: string): Promise<SmokeBrowser> } };

const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, ...a);
const until = async <T>(fn: () => T | null | undefined | Promise<T | null | undefined>, ms: number, what: string): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`기다리다 끝남 — ${what}`); await new Promise((r) => setTimeout(r, 500)); }
};

const ud = mkdtempSync(join(tmpdir(), "flowsmith-ud-"));
writeFileSync(join(ud, "desktop.json"), JSON.stringify({ mode: "local" }));
const env = { ...process.env };
delete env["ELECTRON_RUN_AS_NODE"];
const app = spawn(exe, [`--user-data-dir=${ud}`], { env, stdio: "ignore", detached: false });
let ok = false;
try {
  const logFile = join(ud, "logs", "desktop.log");
  // 처음이면 브라우저(Chromium)를 받는다 — 망에 따라 몇 분
  const url = await until(() => {
    if (!existsSync(logFile)) return null;
    const m = /Z 서버: (http:\/\/127\.0\.0\.1:\d+)\s*$/m.exec(readFileSync(logFile, "utf8"));
    return m?.[1] ?? null;
  }, 15 * 60_000, "서버가 뜨기");
  log("서버:", url);
  const res = await fetch(`${url}/`);
  if (res.status !== 200) throw new Error(`편집 화면이 ${res.status}`);
  const api = async (method: string, path: string, body?: unknown) => (await fetch(`${url}${path}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })).json() as Promise<any>;
  const h1 = { label: "제목", locators: [{ kind: "css", value: "h1" }], fingerprint: null, frames: [], verifiedAt: null };
  const flow = (id: string, browser: string) => ({ schemaVersion: 1, id, name: id, settings: { browser }, nodes: [{ id: "w", type: "web", name: "IANA", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: "https://www.iana.org/domains/reserved" }, actions: [{ id: "r", kind: "read", output: "제목", strategy: "text", target: h1 }] } }], edges: [] });
  const results: Record<string, unknown> = {};
  for (const [id, browser] of [["smoke-launch", "launch"], ["smoke-app", "app"]] as const) {
    await api("POST", "/api/flows", { draft: flow(id, browser) });
    const { runId } = await api("POST", `/api/flows/${id}/runs`, { version: "draft", params: {} });
    const run = await until(async () => { const r = await api("GET", `/api/runs/${runId}`); return r.status !== "running" ? r : null; }, 180_000, `${id} 실행`);
    log(`${browser} 실행:`, run.status, JSON.stringify(run.result?.output ?? {}), run.message ?? "");
    results[browser] = { status: run.status, output: run.result?.output, message: run.message };
    if (run.status !== "success") throw new Error(`${browser} 실행이 ${run.status} — ${run.message}`);
  }
  // 편집 화면 캡쳐 — 앱의 CDP로(앱 안 브라우저 실행 기록)
  const port = readFileSync(join(ud, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0]!.trim();
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const editor = b.contexts()[0]!.pages().find((p) => p.url().startsWith(url));
  if (editor) {
    await editor.goto(`${url}/#/flows/smoke-app`);
    await editor.waitForTimeout(2500);
    await editor.screenshot({ path: join(out, "smoke-editor.png"), timeout: 15_000 }).catch((e) => log("캡쳐 못 함:", (e as Error).message));
  }
  await b.close();
  writeFileSync(join(out, "smoke-result.json"), JSON.stringify({ platform: process.platform, arch: process.arch, url, results }, null, 2));
  ok = true;
  log("됨");
} catch (e) {
  log("실패:", (e as Error).message);
  try { console.log(readFileSync(join(ud, "logs", "desktop.log"), "utf8").split("\n").slice(-30).join("\n")); } catch { /* 로그 없음 */ }
} finally {
  app.kill();
}
process.exit(ok ? 0 : 1);
