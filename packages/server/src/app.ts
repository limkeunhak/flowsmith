/**
 * 부품을 한데 묶는다 — 저장소 · 시크릿 상자 · 워커 → API 서버.
 * 시험은 이걸로 서버를 띄운다(워커를 갈아 끼울 수 있다).
 */
import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { ExtensionRegistry } from "@flowsmith/engine";
import { createApi } from "./http/api.ts";
import { Files } from "./storage/files.ts";
import { RunScreens } from "./live/run-screens.ts";
import { Housekeeper, type Retention } from "./run/housekeeping.ts";
import { LiveHub } from "./live/recorder-hub.ts";
import { Upgrades } from "./live/upgrade.ts";
import { Monitor } from "./run/monitor.ts";
import { Notifier } from "./run/notifier.ts";
import type { Mailer } from "./run/mailer.ts";
import { Auth, type AuthOptions } from "./auth/auth.ts";
import { Chainer, FileWatcher } from "./run/chain.ts";
import { SuiteRunner } from "./run/suites.ts";
import { Scheduler } from "./run/triggers.ts";
import { Runs } from "./run/runs.ts";
import type { SecretBox } from "./storage/secret-box.ts";
import { Secrets } from "./storage/secrets.ts";
import { Store } from "./storage/store.ts";
import type { WorkerClient } from "./run/worker.ts";
import { WorkerHub } from "./run/worker-hub.ts";
import { Plugins } from "./run/plugins.ts";
import { Ai, type AiOptions } from "./run/ai.ts";
import type { TrustedKey } from "@flowsmith/worker";
import { enginePolicy } from "@flowsmith/engine";

export interface App {
  url: string;
  server: Server;
  store: Store;
  runs: Runs;
  screens: RunScreens;
  housekeeper: Housekeeper;
  monitor: Monitor;
  scheduler: Scheduler;
  notifier: Notifier;
  auth: Auth;
  /** 워커 나눠 주기 — 서버 안 · 사람 PC의 워커들 */
  workers: WorkerHub;
  /** 다른 플로우가 끝나면 · 파일이 생기면 — 시험이 직접 tick을 부른다 */
  chainer: Chainer;
  fileWatcher: FileWatcher | null;
  /** Suite — 웹 e2e 테스트 묶음(시험이 직접 tick · wait) */
  suites: SuiteRunner;
  /** 확장 플러그인(run/plugins.ts) */
  plugins: Plugins;
  /** AI로 워크플로우 만들기(run/ai.ts) */
  ai: Ai;
  close(): Promise<void>;
}

export async function startApp(opts: {
  /** worker — 서버 안에서 도는 워커(같은 프로세스). 사람 PC의 워커는 WorkerHub가 따로 받는다 */
  dbPath: string; box: SecretBox; worker: WorkerClient; port?: number; host?: string; staticDir?: string | null;
  /** 화면에 보일 확장 목록 — 워커에 넣은 것과 같은 것을 준다. 없으면 서버 안 워커(InProcessWorker)의 것 */
  extensions?: ExtensionRegistry;
  /**
   * 확장 플러그인(PLAN §41) — 묶음을 두는 곳(기본 DB 옆 plugins/) · 서명된 것만 받나(기본 예) · 믿는 키 · 사내 저장소 기본 주소
   */
  plugins?: { dir?: string; requireSigned?: boolean; keys?: TrustedKey[]; source?: string | null };
  /** AI — 키(FLOWSMITH_ANTHROPIC_KEY) · 시험은 fetch를 가로챈다 */
  ai?: AiOptions;
  /** 주기 감시를 돌리나(기본 켬). 시험은 끄고 직접 tick을 부른다 */
  monitor?: boolean;
  /** 일정 트리거를 돌리나(기본 켬). 시험은 끄고 직접 tick을 부른다 — 파일이 생기면(FileWatcher)도 같이 */
  schedule?: boolean;
  /** 사람의 크롬 — «사람의 브라우저에 붙기» 플로우의 녹화가 쓴다(실행은 워커가 따로 안다) */
  cdpUrl?: string;
  /** 파일 쓰기 노드의 파일 뿌리 — 화면이 저장된 파일을 보고 받는다(워커에도 같은 곳을 준다) */
  filesDir?: string;
  /** 서버 전체에서 동시에 도는 실행 수(기본 3) — 넘으면 차례를 기다린다 */
  maxConcurrentRuns?: number;
  /** 기록 정리(기본 켬 — 실행 500개/플로우 · 90일). false면 끈다(시험) */
  retention?: Partial<Retention> | false;
  /** 알림 속 링크의 앞부분 — 밖에서 여는 주소(FLOWSMITH_PUBLIC_URL). 없으면 이 서버의 주소 */
  publicUrl?: string;
  /** 알림을 보낼 때 — 시험이 가로챈다 */
  notifyFetch?: typeof fetch;
  /** 메일 알림 — SMTP(main.ts가 FLOWSMITH_SMTP_URL로 만든다). 없으면 메일 채널은 «보낼 서버가 없음» */
  mailer?: Mailer | null;
  /** 로그인 · 권한(사내 서버형). 기본 끔 — 시험 · 이 PC에서 혼자 쓸 때. main.ts가 켠다 */
  auth?: AuthOptions;
  /** https — 인증서 · 키(PEM) */
  tls?: { cert: string | Buffer; key: string | Buffer };
  /** HTTP 주소 지킴이가 더 막는 것(FLOWSMITH_HTTP_DENY) — 워커에도 같은 정책을 보낸다 */
  httpDeny?: string[];
}): Promise<App> {
  const store = new Store(opts.dbPath);
  const interrupted = store.markInterrupted();
  if (interrupted > 0) console.warn(`끊긴 실행 ${interrupted}개를 실패로 적었습니다(서버가 다시 시작됨)`);
  const secrets = new Secrets(store, opts.box);
  // 확장 — 화면 · 실행이 보는 레지스트리 하나. 플러그인이 통째로 바꾼다(run/plugins.ts) · 처음 것(환경변수로 실은 확장)은 «서버에 고정»
  const inWorker = (opts.worker as { extensions?: unknown }).extensions;
  const registry = opts.extensions ?? (inWorker instanceof ExtensionRegistry ? inWorker : new ExtensionRegistry());
  const plugins = new Plugins(store.plugins, {
    dir: opts.plugins?.dir ?? (opts.dbPath === ":memory:" ? mkdtempSync(join(tmpdir(), "flowsmith-plugins-")) : join(dirname(opts.dbPath), "plugins")),
    requireSigned: opts.plugins?.requireSigned ?? true, keys: opts.plugins?.keys ?? [], source: opts.plugins?.source ?? null,
    base: registry.snapshot(), registry, log: (t) => console.warn(t),
  });
  await plugins.start();
  const ai = new Ai(store.plugins, store.ai, opts.box, opts.ai ?? {});
  // ★워커에도 서버의 실행 정책을 그대로 — 커스텀 코드 · HTTP 주소 지킴이
  const workers = new WorkerHub(store, opts.worker, { filesDir: opts.filesDir ?? null, plugins, policy: () => ({ customCode: enginePolicy.customCode, httpGuard: enginePolicy.httpGuard !== null, httpDeny: opts.httpDeny ?? [] }) });
  plugins.onChange(() => workers.pluginsChanged());
  const runs = new Runs(store, secrets, workers, opts.maxConcurrentRuns !== undefined ? { maxConcurrent: opts.maxConcurrentRuns } : {});
  const housekeeper = new Housekeeper(store, opts.retention || {});
  if (opts.retention !== false) housekeeper.start();
  const monitor = new Monitor(store, secrets, workers);
  let selfUrl = "";
  const notifier = new Notifier(store, secrets, { publicUrl: () => opts.publicUrl ?? selfUrl, mailer: opts.mailer ?? null, ...(opts.notifyFetch ? { fetch: opts.notifyFetch, retryDelayMs: 50 } : {}) });
  runs.notifier = notifier;
  monitor.notifier = notifier;
  const scheduler = new Scheduler(store, runs);
  if (opts.schedule !== false) scheduler.start();
  // 다른 플로우가 끝나면 · 파일이 생기면(run/chain.ts)
  const chainer = new Chainer(store, runs, secrets);
  runs.onFinished = (f) => { chainer.finished(f); };
  const fileWatcher = opts.filesDir ? new FileWatcher(store, runs, opts.filesDir) : null;
  if (fileWatcher && opts.schedule !== false) fileWatcher.start();
  // Suite — 웹 e2e 테스트 묶음(run/suites.ts) · 일정은 일정 트리거와 같이 켜고 끈다
  const suites = new SuiteRunner(store, runs, notifier);
  if (opts.schedule !== false) suites.startSchedule();
  runs.onBreakage = (flowId, version) => { try { monitor.probe(flowId, version ?? "draft", "run"); } catch { /* 초안이 틀려 있으면 점검하지 않는다 */ } };
  if (opts.monitor !== false) monitor.start();
  const auth = new Auth(store, opts.auth ?? { enabled: false });
  const server = createApi({ store, secrets, runs, monitor, notifier, auth, workers, suites, tls: opts.tls ?? null, staticDir: opts.staticDir ?? null, extensions: registry, plugins, ai, files: opts.filesDir ? new Files(opts.filesDir) : null });
  // WebSocket 길 — 한 곳에서 받아 나눈다(맞는 길이 없으면 404)
  const upgrades = new Upgrades(server);
  // 지갑 브라우저 녹화 — 서버 안 워커가 창을 띄울 수 있으면(capabilities에 wallet) 그 워커가 연다
  // 앱 안 브라우저 녹화 — 데스크톱 앱 안의 워커면(capabilities에 app) 편집 화면 자리에 뷰를 놓는다
  type LiveOpts = NonNullable<ConstructorParameters<typeof LiveHub>[2]>;
  const inProc = opts.worker as { capabilities?: string[]; walletSource?: LiveOpts["walletSource"]; appSource?: LiveOpts["appSource"] };
  const walletSource = inProc.capabilities?.includes("wallet") && inProc.walletSource ? inProc.walletSource.bind(opts.worker) : undefined;
  const appSource = inProc.capabilities?.includes("app") && inProc.appSource ? inProc.appSource.bind(opts.worker) : undefined;
  const live = new LiveHub(store, secrets, { workers, ...(opts.cdpUrl ? { cdpUrl: opts.cdpUrl } : {}), ...(walletSource ? { walletSource } : {}), ...(appSource ? { appSource } : {}) });
  live.attach(upgrades, (req) => auth.checkUpgrade(req, "editor"), (req, flowId) => auth.canSeeFlowReq(req, flowId), (req) => auth.upgradeUser(req)?.email ?? null);
  // 실행 화면 보기 — 보는 사람이 있을 때만 화면을 보낸다
  const screens = new RunScreens();
  screens.attach(upgrades, (req) => auth.checkUpgrade(req, "viewer"), (req, runId) => auth.canSeeRunReq(req, runId), (req) => auth.checkUpgrade(req, "runner"));
  runs.screens = screens;
  workers.attach(upgrades);
  const host = opts.host ?? "127.0.0.1";
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, host, resolve));
  const { port } = server.address() as AddressInfo;
  selfUrl = `${opts.tls ? "https" : "http"}://${host}:${port}`;
  return {
    url: selfUrl,
    server, store, runs, screens, housekeeper,
    monitor, scheduler, notifier, auth, workers, chainer, fileWatcher, suites, plugins, ai,
    async close() {
      scheduler.stop();
      suites.stop();
      fileWatcher?.stop();
      housekeeper.stop();
      await monitor.stop();
      await live.close();
      await screens.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await runs.drain();
      await notifier.drain();
      await workers.close();   // 서버 안의 워커도 함께 끈다
      store.close();
    },
  };
}
