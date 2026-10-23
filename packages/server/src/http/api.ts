/**
 * **HTTP API** — 영역마다의 길(routes/*)을 모아 서버를 만든다. 오류는 언제나 `{ error, problems? }`.
 *
 *   routes/flows.ts     플로우 · 버전 · 배포 · 시크릿 · 확장 목록
 *   routes/runs.ts      실행 · 진행(SSE) · 변경 감시(점검)
 *   routes/triggers.ts  웹훅(켜기 · 끄기 · 받기)
 *   routes/files.ts     파일 쓰기 노드가 쓴 파일들
 *   routes/notify.ts    알림 — 보낸 기록 · 시험 보내기
 *   routes/auth.ts      로그인 · 사람(관리자)
 *   routes/workers.ts   워커(젠킨스의 노드) · 어디서 돌리나
 *   routes/dashboard.ts 대시보드 — 실행 · 노드 · 날마다 · 오류
 *   routes/tokens.ts    API 토큰(밖에서 부를 때 — Bearer fsa_…)
 *   routes/suites.ts    Suite — 웹 e2e 테스트 묶음(시나리오 · 전체/단건 실행 · 판정)
 *   routes/shared.ts    팀 공용 값 — 여러 플로우가 함께 쓰는 변수 · 시크릿
 *   /api/openapi.json   명세 — 이 길들 + docs.ts의 설명(openapi.ts)
 * ★권한은 길마다가 아니라 auth/auth.ts의 needOf 한 곳에서 — serve의 guard가 길에 닿기 전에 본다
 *
 * WebSocket은 따로: /api/live(녹화 — live/recorder-hub.ts) · /api/runs/:id/screen(실행 화면 — live/run-screens.ts) ·
 * /api/workers/connect(워커 프로그램 — run/worker-hub.ts, 워커 토큰으로).
 */
import type { Server } from "node:http";
import type { ExtensionRegistry } from "@flowsmith/engine";
import type { Store } from "../storage/store.ts";
import type { Secrets } from "../storage/secrets.ts";
import type { Files } from "../storage/files.ts";
import type { Runs } from "../run/runs.ts";
import type { Monitor } from "../run/monitor.ts";
import type { Notifier } from "../run/notifier.ts";
import { route, serve, type Route } from "./router.ts";
import { openapi } from "./openapi.ts";
import { tokenRoutes } from "./routes/tokens.ts";
import { sharedRoutes } from "./routes/shared.ts";
import { suiteRoutes } from "./routes/suites.ts";
import { pluginRoutes } from "./routes/plugins.ts";
import { aiRoutes } from "./routes/ai.ts";
import type { Ai } from "../run/ai.ts";
import type { Plugins } from "../run/plugins.ts";
import type { SuiteRunner } from "../run/suites.ts";
import { flowRoutes } from "./routes/flows.ts";
import { runRoutes } from "./routes/runs.ts";
import { triggerRoutes } from "./routes/triggers.ts";
import { fileRoutes } from "./routes/files.ts";
import { notifyRoutes } from "./routes/notify.ts";
import { authRoutes } from "./routes/auth.ts";
import { workerRoutes } from "./routes/workers.ts";
import { dashboardRoutes } from "./routes/dashboard.ts";
import type { WorkerHub } from "../run/worker-hub.ts";
import type { Auth } from "../auth/auth.ts";

export interface ApiDeps {
  store: Store;
  secrets: Secrets;
  runs: Runs;
  /** 편집 화면(빌드된 apps/studio/dist). 있으면 /api 밖의 GET을 여기서 내준다 */
  staticDir?: string | null;
  extensions: ExtensionRegistry;
  monitor: Monitor;
  notifier: Notifier;
  auth: Auth;
  /** 워커 나눠 주기 — 워커 화면이 지금 상태를 본다 */
  workers: WorkerHub;
  /** Suite 실행 — 웹 e2e 테스트 묶음 */
  suites: SuiteRunner;
  /** https — 인증서 · 키 */
  tls?: { cert: string | Buffer; key: string | Buffer } | null;
  /** 파일 쓰기 노드의 파일 뿌리 — 없으면 파일 API는 404 */
  files?: Files | null;
  /** 확장 플러그인 — 올리기 · 바꾸기 · 되돌리기(run/plugins.ts) */
  plugins: Plugins;
  /** AI — 키를 쥐고 모델을 대신 부른다(run/ai.ts) */
  ai: Ai;
}

/** 모든 길 — 서버와 OpenAPI 명세가 같은 목록을 본다 */
export function apiRoutes(deps: ApiDeps): Route[] {
  const routes = [
    ...flowRoutes(deps), ...runRoutes(deps), ...triggerRoutes(deps), ...fileRoutes(deps), ...notifyRoutes(deps),
    ...authRoutes(deps), ...tokenRoutes(deps), ...workerRoutes(deps), ...dashboardRoutes(deps),...sharedRoutes(deps), ...suiteRoutes(deps), ...pluginRoutes(deps), ...aiRoutes(deps),
  ];
  let spec: unknown = null;   // 길은 서버가 뜬 뒤 바뀌지 않는다 — 한 번만 만든다
  routes.push(route("GET", "/api/openapi.json", () => (spec ??= openapi(routes, { auth: deps.auth.enabled }))));
  return routes;
}

export function createApi(deps: ApiDeps): Server {
  return serve(apiRoutes(deps), deps.staticDir ?? null, {
    guard: (req, method, path) => deps.auth.check(req, method, path),
    ...(deps.tls ? { tls: deps.tls } : {}),
  });
}
