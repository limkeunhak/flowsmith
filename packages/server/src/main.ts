#!/usr/bin/env node
/**
 * 서버를 띄운다 (standalone).
 *
 *   node packages/server/src/main.ts [--port 4400] [--data ./data] [--headed]
 *   node packages/server/src/main.ts keygen          마스터 키를 만들어 표준 출력으로
 *
 * 환경변수: FLOWSMITH_MASTER_KEY_FILE 또는 FLOWSMITH_MASTER_KEY (★없으면 안 뜬다) · HOST(기본 127.0.0.1)
 *
 * 사내 서버형(PLAN §24) — HOST를 이 PC 밖으로 열면(0.0.0.0 · 사내 주소) **로그인이 저절로 켜진다**(끌 수 없다).
 *   FLOWSMITH_AUTH=on|off          이 PC(127.0.0.1)에만 열 때 로그인을 켤지(기본 끔)
 *   FLOWSMITH_SESSION_HOURS        로그인 유지 시간(기본 12 — 쓰는 동안 늘어난다)
 *   FLOWSMITH_TLS_CERT · _TLS_KEY  https 인증서 · 키 파일(PEM). 앞단 프록시가 https를 맡으면 비워 둔다
 *   FLOWSMITH_CUSTOM_CODE=off      커스텀(코드) 노드를 돌리지 않는다 — 코드는 서버 안에서 돈다
 *   FLOWSMITH_HTTP_GUARD=on|off    HTTP 요청 · 알림이 서버 자기 자신 · 클라우드 메타데이터를 부르지 못하게(로그인을 켜면 기본 켬)
 *   FLOWSMITH_HTTP_DENY            더 막을 이름 · IPv4(CIDR), 쉼표로
 *
 * 확장 플러그인(PLAN §41) — «확장» 화면에서 묶음(.fspkg)을 올린다. 데이터 폴더/plugins에 둔다.
 *   FLOWSMITH_PLUGIN_KEYS          믿는 서명 키 파일(한 줄에 «이름 공개키» — flowsmith-ext keygen의 .pub)
 *   FLOWSMITH_PLUGIN_SIGNING=off   서명 없는 묶음도 받는다(기본은 서명된 것만 — 플러그인 코드는 서버 권한으로 돈다)
 *   FLOWSMITH_PLUGIN_SOURCE        사내 저장소 index.json 주소의 기본값(화면에서 바꿀 수 있다)
 *
 * AI로 워크플로우 만들기(PLAN §42) — 키는 지금 사람마다 «내 설정»(브라우저에만). 서버에 둘 때: FLOWSMITH_ANTHROPIC_KEY · FLOWSMITH_GEMINI_KEY
 *
 * 워커(master/worker — PLAN §26): 따로 켤 것은 없다. «워커» 화면에서 워커를 만들고, 그 PC에서
 *   FLOWSMITH_WORKER_TOKEN=… node packages/worker/src/main.ts --server https://이 서버
 * 를 켜면 이 서버에 붙는다. 워커를 하나도 붙이지 않으면 지금처럼 서버 혼자 돈다(standalone).
 */
import { existsSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp } from "./app.ts";
import { loadExtensions } from "./run/extensions.ts";
import { generateKey, MasterKeyError, SecretBox } from "./storage/secret-box.ts";
import { InProcessWorker } from "./run/worker.ts";
import { mailerFromEnv } from "./run/mailer.ts";
import { readFileSync } from "node:fs";
import { configureEngine, makeHttpGuard } from "@flowsmith/engine";
import { parseTrustedKeys, type TrustedKey } from "@flowsmith/worker";

const host = process.env["HOST"] ?? "127.0.0.1";
const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
const authEnv = (process.env["FLOWSMITH_AUTH"] ?? "").trim().toLowerCase();
// ★밖으로 열면 로그인은 끌 수 없다 — 누구나 플로우를 돌리고 서버에서 코드를 실행할 수 있게 된다
if (!loopback && authEnv === "off") { console.error(`HOST=${host}로 열면서 로그인을 끌 수 없습니다 — FLOWSMITH_AUTH=off는 이 PC(127.0.0.1)에만 열 때만 됩니다`); process.exit(1); }
const authOn = !loopback || authEnv === "on";
const tlsCert = process.env["FLOWSMITH_TLS_CERT"], tlsKey = process.env["FLOWSMITH_TLS_KEY"];
if (Boolean(tlsCert) !== Boolean(tlsKey)) { console.error("FLOWSMITH_TLS_CERT와 FLOWSMITH_TLS_KEY는 함께 정합니다"); process.exit(1); }
const tls = tlsCert && tlsKey ? { cert: readFileSync(tlsCert), key: readFileSync(tlsKey) } : undefined;
const guardEnv = (process.env["FLOWSMITH_HTTP_GUARD"] ?? "").trim().toLowerCase();
const httpDeny = (process.env["FLOWSMITH_HTTP_DENY"] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
configureEngine({
  customCode: (process.env["FLOWSMITH_CUSTOM_CODE"] ?? "").trim().toLowerCase() !== "off",
  httpGuard: guardEnv === "on" || (guardEnv !== "off" && authOn)
    ? makeHttpGuard(httpDeny) : null,
});

const argv = process.argv.slice(2);

if (argv[0] === "keygen") {
  process.stdout.write(`${generateKey()}\n`);
  process.exit(0);
}

// 워커 토큰 — 화면 없이(도커 컴포즈 · 설치 스크립트). 이름이 있으면 새 토큰(그 워커의 지금 연결은 끊긴다)
//   node packages/server/src/main.ts add-worker "도커 워커 1" [--labels a,b] [--slots 1] [--data ./data]  → 토큰만 표준 출력으로
if (argv[0] === "add-worker") {
  const name = argv[1];
  if (!name || name.startsWith("--")) { console.error('워커 이름을 주세요 — add-worker "김담당 PC" [--labels a,b] [--slots 1]'); process.exit(1); }
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const { Store } = await import("./storage/store.ts");
  const store = new Store(join(resolve(flag("--data") ?? "data"), "flowsmith.db"));
  try {
    const have = store.listWorkers().find((w) => w.name === name);
    const token = have ? store.renewWorkerToken(have.id) : store.createWorker({ name, labels: flag("--labels") ?? [], slots: flag("--slots") ?? 1 }).token;
    if (have && (flag("--labels") !== undefined || flag("--slots") !== undefined)) store.updateWorker(have.id, { ...(flag("--labels") !== undefined ? { labels: flag("--labels") } : {}), ...(flag("--slots") !== undefined ? { slots: Number(flag("--slots")) } : {}) });
    process.stdout.write(`${token}\n`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  } finally {
    store.close();
  }
  process.exit(0);
}

/** 숫자 환경변수 — 0이면 «끄기»로 쓴다 */
const numEnv = (name: string): number | undefined => {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) { console.error(`${name}는 0 이상의 정수여야 합니다(받은 값: ${v})`); process.exit(1); }
  return n;
};

const opt = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

let box: SecretBox;
try {
  box = SecretBox.fromEnv();
} catch (e) {
  if (e instanceof MasterKeyError) { console.error(e.message); process.exit(1); }
  throw e;
}

const dataDir = resolve(opt("--data") ?? "data");
// ☆옛 이름(Page Relay)의 DB가 있으면 새 이름으로 옮긴다 — 2026-10-15 이름을 Flowsmith로 바꿨다
for (const ext of ["", "-wal", "-shm"]) {
  const from = join(dataDir, `page-relay.db${ext}`), to = join(dataDir, `flowsmith.db${ext}`);
  if (existsSync(from) && !existsSync(to)) renameSync(from, to);
}
// 확장 — FLOWSMITH_EXTENSIONS=모듈,모듈 · 사람의 크롬 — FLOWSMITH_CDP_URL (기본 http://127.0.0.1:9222)
const extensions = await loadExtensions((process.env["FLOWSMITH_EXTENSIONS"] ?? "").split(",")).catch((e: Error) => { console.error(e.message); process.exit(1); });
const cdpUrl = process.env["FLOWSMITH_CDP_URL"];
// 확장 플러그인 — 믿는 키 · 서명 정책 · 사내 저장소
const keysFile = process.env["FLOWSMITH_PLUGIN_KEYS"];
let pluginKeys: TrustedKey[] = [];
try { pluginKeys = keysFile ? parseTrustedKeys(readFileSync(keysFile, "utf8")) : []; } catch (e) { console.error(`믿는 키 파일(${keysFile}): ${(e as Error).message}`); process.exit(1); }
const requireSigned = (process.env["FLOWSMITH_PLUGIN_SIGNING"] ?? "").trim().toLowerCase() !== "off";
// 파일 쓰기 노드가 파일을 쓰는 곳 — FLOWSMITH_FILES_DIR (기본 데이터 폴더/files)
const filesDir = resolve(process.env["FLOWSMITH_FILES_DIR"] ?? join(dataDir, "files"));
// 편집 화면 — 빌드돼 있으면 같이 내준다 (pnpm studio:build)
const studioDir = fileURLToPath(new URL("../../../apps/studio/dist", import.meta.url));
const staticDir = existsSync(join(studioDir, "index.html")) ? studioDir : null;
const app = await startApp({
  auth: { enabled: authOn, ...(numEnv("FLOWSMITH_SESSION_HOURS") ? { sessionHours: numEnv("FLOWSMITH_SESSION_HOURS")! } : {}) },
  ...(tls ? { tls } : {}),
  staticDir,
  dbPath: join(dataDir, "flowsmith.db"),
  box,
  // 지갑 브라우저 — --headed면 저절로 · FLOWSMITH_WALLET_BROWSER=on이면 띄우는 브라우저는 창 없이 두고 지갑 브라우저만 창을 띄운다(데스크톱 앱)
  worker: new InProcessWorker({ headless: !argv.includes("--headed"), walletWindow: (process.env["FLOWSMITH_WALLET_BROWSER"] ?? "").trim().toLowerCase() === "on", extensions, filesDir, ...(cdpUrl ? { cdpUrl } : {}) }),
  filesDir,
  extensions,
  ai: { envKey: process.env["FLOWSMITH_ANTHROPIC_KEY"]?.trim() || null, envGeminiKey: process.env["FLOWSMITH_GEMINI_KEY"]?.trim() || null },
  plugins: { dir: join(dataDir, "plugins"), requireSigned, keys: pluginKeys, source: process.env["FLOWSMITH_PLUGIN_SOURCE"] ?? null },
  // 운영 — FLOWSMITH_MAX_RUNS(동시 실행 · 기본 3) · FLOWSMITH_KEEP_RUNS(플로우마다 실행 기록 · 기본 500) · FLOWSMITH_KEEP_DAYS(일 · 기본 90)
  ...(numEnv("FLOWSMITH_MAX_RUNS") !== undefined ? { maxConcurrentRuns: numEnv("FLOWSMITH_MAX_RUNS")! } : {}),
  retention: {
    ...(numEnv("FLOWSMITH_KEEP_RUNS") !== undefined ? { keepRuns: numEnv("FLOWSMITH_KEEP_RUNS")! || null } : {}),
    ...(numEnv("FLOWSMITH_KEEP_DAYS") !== undefined ? { keepDays: numEnv("FLOWSMITH_KEEP_DAYS")! || null } : {}),
  },
  ...(cdpUrl ? { cdpUrl } : {}),
  // 메일 알림 — FLOWSMITH_SMTP_URL(smtp://사용자:비밀번호@서버:587) · FLOWSMITH_MAIL_FROM
  mailer: (() => { try { return mailerFromEnv(); } catch (e) { console.error((e as Error).message); process.exit(1); } })(),
  // 알림 속 링크 — 밖(Slack · Teams)에서 열 주소. 없으면 이 서버의 주소(127.0.0.1이면 다른 PC에서는 안 열린다)
  ...(process.env["FLOWSMITH_PUBLIC_URL"] ? { publicUrl: process.env["FLOWSMITH_PUBLIC_URL"] } : {}),
  httpDeny,
  port: Number(opt("--port") ?? 4400),
  host,
});
console.log(`Flowsmith 서버: ${app.url}   (데이터: ${dataDir} · 저장 파일: ${filesDir})`);
console.log(authOn ? `로그인: 켬${tls ? " · https" : " · http(앞단 프록시에서 https를 맡기세요)"}` : "로그인: 끔 — 이 PC에서 혼자 쓰는 모드");
if (app.auth.setupToken) console.log(`\n★ 아직 사람이 없습니다 — 편집 화면을 열고 이 설정 토큰으로 첫 관리자를 만드세요:\n   ${app.auth.setupToken}\n`);
if (extensions.list().length) console.log(`확장: ${extensions.list().map((e) => e.id).join(", ")}`);
console.log(`확장 플러그인: ${app.plugins.list().filter((p) => p.enabled).map((p) => `${p.id} ${p.version}`).join(", ") || "없음"} · ${requireSigned ? `서명된 것만(믿는 키 ${pluginKeys.length}개)` : "서명 없이도 받음"}`);
console.log(staticDir ? `편집 화면: ${app.url}/` : "편집 화면이 빌드돼 있지 않습니다 — pnpm studio:build (또는 개발 중이면 pnpm studio:dev)");

const stop = async () => { console.log("끄는 중…"); await app.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// 데스크톱 앱(Electron utilityProcess)이 띄웠으면 — 앱이 닫힐 때 «stop»을 보낸다(Windows에는 SIGTERM이 없다)
(process as { parentPort?: { on(e: "message", f: (m: { data: unknown }) => void): void; postMessage(m: unknown): void } }).parentPort?.on("message", (m) => { if (m.data === "stop") void stop(); });
(process as { parentPort?: { postMessage(m: unknown): void } }).parentPort?.postMessage({ t: "ready", url: app.url });
