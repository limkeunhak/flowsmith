/**
 * **회사 서버의 워커로 붙는다**(4단계 · DESKTOP.md §13) — 데스크톱 앱이 «회사 서버에 붙기»로 켜졌을 때 boot.ts가 이것을 띄운다(utilityProcess).
 *
 *   이 PC의 서버는 띄우지 않는다 — 워크플로우 · 시크릿 · 실행 기록은 회사 서버에 있다. 이 PC는 «내 PC에서 실행하기»로 온 실행을 돌린다.
 *   앱 안 브라우저(뷰)는 앱이 열어 준다(AppViews — 3단계와 같은 길) · «띄우기» 플로우도 실행 창에서(사람이 본다) · 지갑 브라우저는 창을 띄운다.
 *
 * 앱과 주고받는 말(parentPort): 이 → 앱 { t: "agent", state, id, name, message } · 앱 → 이 "stop" · 뷰 부탁(app-views.ts)
 * 환경변수: FLOWSMITH_SERVER · FLOWSMITH_WORKER_TOKEN · FLOWSMITH_APP_CDP · FLOWSMITH_DATA(플러그인을 받아 둘 곳)
 */
import { join } from "node:path";
import { configureEngine, makeHttpGuard } from "@flowsmith/engine";
import { AppViews, InProcessWorker, WorkerAgent, type AgentState } from "@flowsmith/worker";

type Port = { on(e: "message", f: (m: { data: unknown }) => void): void; postMessage(m: unknown): void };
const port = (process as { parentPort?: Port }).parentPort;
if (!port) throw new Error("데스크톱 앱이 띄워야 합니다(parentPort)");

const server = process.env["FLOWSMITH_SERVER"] ?? "";
const token = process.env["FLOWSMITH_WORKER_TOKEN"] ?? "";
const cdp = process.env["FLOWSMITH_APP_CDP"];
const data = process.env["FLOWSMITH_DATA"] ?? ".";
delete process.env["FLOWSMITH_WORKER_TOKEN"];

const views = cdp ? new AppViews(cdp, { post: (m) => port.postMessage(m), onMessage: (fn) => port.on("message", (m) => fn(m.data)) }) : undefined;
const worker = new InProcessWorker({ headless: true, walletWindow: true, launchInApp: true, ...(views ? { appViews: views } : {}) });
const agent = new WorkerAgent({
  server, token, worker,
  pluginsDir: join(data, "worker-plugins"),
  // ★서버의 정책을 따른다(커스텀 코드 · HTTP 주소 지킴이)
  onPolicy: (p) => configureEngine({ customCode: p.customCode, httpGuard: p.httpGuard ? makeHttpGuard(p.httpDeny) : null }),
  log: (t) => console.log(t),
});

let last = "";
const report = (state: AgentState, message: string | null = null) => {
  const m = { t: "agent", state, id: agent.id, name: agent.name, message };
  const key = JSON.stringify(m);
  if (key === last) return;
  last = key;
  port.postMessage(m);
};
// 상태는 바뀔 때만 알린다(끊김 → 다시 붙기도 보인다)
setInterval(() => report(agent.state), 1_000).unref();
agent.start().then(() => report(agent.state), (e: Error) => report("denied", e.message));

port.on("message", (m) => {
  if (m.data !== "stop") return;
  void agent.close().finally(() => process.exit(0));
});
