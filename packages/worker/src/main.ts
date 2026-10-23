#!/usr/bin/env node
/**
 * 워커를 켠다 — 사람 PC에서 서버에 붙어 일을 받아 돌린다 (PLAN §26).
 *
 *   FLOWSMITH_WORKER_TOKEN=<관리자가 준 토큰> node packages/worker/src/main.ts --server https://studio.사내 [--headed]
 *
 * 환경변수
 *   FLOWSMITH_WORKER_TOKEN            워커 토큰(«워커» 화면에서 만들 때 한 번 보인다) · 또는 --token-file 파일
 *   FLOWSMITH_CDP_URL          이 PC의 크롬(«사람의 브라우저에 붙기» 플로우) — 기본 http://127.0.0.1:9222
 *   FLOWSMITH_EXTENSIONS       이 PC에 깔 확장 모듈(쉼표로) — 서버와 같은 것을. ☆플러그인(«확장» 화면)은 서버가 저절로 나눠 준다
 *   FLOWSMITH_WORKER_PLUGINS_DIR      서버가 나눠 준 플러그인을 받아 두는 곳(기본 ~/.flowsmith/worker-plugins) · 또는 --plugins-dir
 *   FLOWSMITH_CUSTOM_CODE=off  서버가 켜 두어도 이 PC에서는 커스텀(코드) 노드를 돌리지 않는다
 *   FLOWSMITH_WORKER_ALLOW_HTTP=1     https가 아닌 서버에 붙는다(★시크릿이 그대로 오간다 — 시험용)
 */
import { readFileSync } from "node:fs";
import { configureEngine, makeHttpGuard } from "@flowsmith/engine";
import { WorkerAgent } from "./agent.ts";
import { loadExtensions } from "./extensions.ts";
import { InProcessWorker } from "./local.ts";

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const die = (text: string): never => { console.error(text); process.exit(1); };

const server = opt("--server") ?? process.env["FLOWSMITH_WORKER_SERVER"] ?? die("서버 주소가 없습니다 — --server https://studio.사내");
let url: URL;
try { url = new URL(server); } catch { die(`서버 주소를 읽을 수 없습니다: ${server}`); }
const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url!.hostname);
if (url!.protocol === "http:" && !loopback && process.env["FLOWSMITH_WORKER_ALLOW_HTTP"] !== "1") {
  die(`${server}는 https가 아닙니다 — 이 연결로 시크릿(비밀번호)이 오갑니다. https 주소를 쓰세요(시험이면 FLOWSMITH_WORKER_ALLOW_HTTP=1)`);
}
const tokenFile = opt("--token-file");
const token = (tokenFile ? readFileSync(tokenFile, "utf8") : process.env["FLOWSMITH_WORKER_TOKEN"] ?? "").trim() || die("워커 토큰이 없습니다 — FLOWSMITH_WORKER_TOKEN 또는 --token-file");

const extensions = await loadExtensions((process.env["FLOWSMITH_EXTENSIONS"] ?? "").split(",")).catch((e: Error) => die(e.message));
const cdpUrl = process.env["FLOWSMITH_CDP_URL"];
const localCustomCode = (process.env["FLOWSMITH_CUSTOM_CODE"] ?? "").trim().toLowerCase() !== "off";
const worker = new InProcessWorker({ headless: !argv.includes("--headed"), extensions, ...(cdpUrl ? { cdpUrl } : {}) });

const agent = new WorkerAgent({
  server, token, worker,
  ...(opt("--plugins-dir") ? { pluginsDir: opt("--plugins-dir")! } : {}),
  // ★서버의 정책을 따른다 — 이 PC가 더 막을 수는 있어도 풀 수는 없다
  onPolicy: (p) => configureEngine({ customCode: p.customCode && localCustomCode, httpGuard: p.httpGuard ? makeHttpGuard(p.httpDeny) : null }),
});
console.log(`Flowsmith 워커 — ${server}에 붙는 중…${extensions.list().length ? ` (확장: ${extensions.list().map((e) => e.id).join(", ")})` : ""}`);
await agent.start().catch((e: Error) => die(e.message));

const stop = async () => { console.log("끄는 중…"); await agent.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
