/**
 * 서버 API — packages/server/src/http/routes/*와 짝이다.
 * 응답의 모양은 서버의 타입(`@flowsmith/server/api-types` — 타입만, node: 모듈 없음)을 그대로 쓴다.
 * 화면이 더 좁게 아는 것만 여기서 좁힌다 — 초안은 Flow · 실행 결과는 RunResult · 점검 보고서는 ProbeReport.
 */
import type { Flow, Locator, NotifyRule, ProbeReport } from "@flowsmith/core";
import type * as Server from "@flowsmith/server/api-types";
import type { Role, Team, User } from "./shell/me.ts";
import { myAiKey, myAiModel, myAiProvider } from "./ai/key.ts";

export type TeamRow = Server.TeamRow;
export type ApiTokenRow = Server.ApiTokenRow;
/** 워커(젠킨스의 노드) — 실행을 받아 가는 PC · 지금 상태. ★토큰은 만들 때 한 번만 온다 */
export type WorkerRow = Server.WorkerRow & Server.WorkerLive;
export type WorkersView = Server.WorkersView;
/** 대시보드 — 서버의 run/stats.ts가 모은 숫자 + 고를 수 있는 플로우 */
export type DashboardView = Server.Dashboard & { flows: { id: string; name: string }[] };
export type FlowSummary = Server.FlowSummary;
export type ProbeRow = Omit<Server.ProbeRow, "report"> & { report: ProbeReport | null };
export type FlowDetail = Omit<Server.FlowDetail, "draft"> & { draft: Flow };
/** 보낸 알림 — 주소는 없다 */
export type NoticeRow = Server.NoticeRow;
export type { ProbeReport };

export class ApiError extends Error {
  readonly status: number;
  readonly problems: string[];
  constructor(status: number, message: string, problems: string[]) {
    super(message);
    this.status = status;
    this.problems = problems;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  // 로그인이 끊겼다(만료 · 관리자가 끔) — 로그인 화면으로
  if (r.status === 401 && !path.startsWith("/auth/")) dispatchEvent(new Event("flowsmith:login-required"));
  if (!r.ok) throw new ApiError(r.status, data?.error ?? `요청 실패 (${r.status})`, data?.problems ?? []);
  return data as T;
}

export interface FileEntry { name: string; path: string; kind: "file" | "dir"; size: number; modified: string }
/** shared — 팀 공용 값을 쓴다(stored는 그 값이 있나 · sharedScope는 어디서 찾았나: 팀 id · "" 공용) */
export interface SecretStatus { name: string; kind: "text" | "login" | null; description: string; stored: boolean; updatedAt: string | null; orphan: boolean; shared?: boolean; sharedScope?: string | null }
/** 팀 공용 값 — scope는 팀 id · ""(공용). 시크릿은 value가 늘 null */
export interface SharedValue { scope: string; kind: "var" | "secret"; name: string; secretKind: "text" | "login" | null; description: string; value: string | null; updatedAt: string; updatedBy: string | null }
/** Suite — 웹 e2e 테스트 묶음 */
export type SuiteView = Server.Suite;
export type SuiteRunView = Server.SuiteRun;
export type SuiteSummary = Server.Suite & { lastRun: Server.SuiteRun | null; running: boolean };
export interface SuiteDetail { suite: Server.Suite; runs: Server.SuiteRun[]; running: boolean }
/** AI 도우미 — 켜 둠 · 키가 있나(값은 오지 않는다) · 모델 */
export interface AiProviderStatus { label: string; models: string[]; model: string; keyHint: string; serverKey: "env" | "screen" | null }
export interface AiStatus { enabled: boolean; ready: boolean; model: string; models: string[]; key: "env" | "screen" | null; providers: Record<"anthropic" | "gemini", AiProviderStatus>; /** AI가 사이트 화면을 본다(관리자 설정 · 기본 끔) */ siteView: boolean }
/** 확장 플러그인 — «확장» 화면 */
export type PluginsView = Server.PluginsView;
export type PluginView = Server.PluginView;
export type PluginSourceEntry = Server.PluginSourceEntry;
/** 승인을 기다리는 실행 */
export interface PendingApproval { runId: string; flowId: string; flowName: string; version: number | null; nodeId: string; nodeName: string; message: string; minRole: "runner" | "editor" | "admin"; deadline: string; since: string }

/** blocked — 고르면 안 되는 행에 걸렸다(막힘 갈래로 갔거나, 잇지 않아 멈췄거나) */
export type NodeStatus = "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled" | "blocked";
export interface StepLog { index: number; id: string; kind: string; label: string; ms: number; note: string }
export interface StepFailure {
  problem: "missing" | "many" | "forbidden" | "notFilled" | "noPage" | "refused" | "mismatch" | "check" | "timeout" | "stopped" | "other";
  message: string; action: { index: number; id: string; kind: string } | null; label: string | null;
  locator: Locator | null; url: string | null; candidates: { locator: Locator; count: number }[];
}
export interface NodeRun {
  id: string; name: string; type: string; status: NodeStatus; input: Record<string, unknown> | null; output: Record<string, unknown> | null;
  branch: string | null; steps: StepLog[]; logs: string[]; failure: StepFailure | null; ms: number;
  /** 시작한 때 — 옛 기록에는 없다(시간표가 차례로 이어 붙여 짐작한다) */
  startedAt?: string | null;
  /** 고정된 출력을 썼다(돌지 않았다) */
  pinned?: boolean;
  /** 검사 노드 — 항목마다의 판정 */
  checks?: { id: string; label: string; op: string; actual: string; expected: string | null; pass: boolean; error: string | null }[];
}
export interface RunResult { runId: string; flowId: string; status: "success" | "failure" | "cancelled" | "blocked"; message: string; output: Record<string, unknown>; nodes: NodeRun[]; startedAt: string; ms: number }
/** 실행 기록 — 목록에는 결과 본문이 없다(result가 빠진다) */
export type RunRow = Omit<Server.RunRow, "result"> & { result?: RunResult | null };
export type Watch =
  | { kind: "node:start"; nodeId: string; input: Record<string, unknown> }
  | { kind: "step"; nodeId: string; step: StepLog }
  | { kind: "log"; nodeId: string; text: string }
  | { kind: "node:end"; node: NodeRun }
  | { kind: "run:end"; status: "success" | "failure" | "cancelled" | "blocked"; message: string }
  | { kind: "run:queued"; ahead: number }
  | { kind: "run:placed"; worker: string }
  | { kind: "run:locked"; lock: string; holder: string }
  /** 사람 기다리기 — waiting(언제까지) · 끝(done · timeout · stopped · failed) */
  | { kind: "human"; nodeId: string; actionId: string; index: number; state: "waiting" | "done" | "timeout" | "stopped" | "failed"; prompt: string; deadline: string | null }
  /** 승인 기다리기 — waiting(언제까지 · 누가) · 끝(approved · rejected · timeout · stopped) */
  | { kind: "approval"; nodeId: string; state: "waiting" | "approved" | "rejected" | "timeout" | "stopped"; message: string; minRole: "runner" | "editor" | "admin"; deadline: string | null; by?: string | null; comment?: string };

export const api = {
  // ── 로그인 · 사람 (사내 서버형)
  me: () => call<{ auth: "off" } | { auth: "on"; user: User | null; setup: boolean; teams?: Team[] }>("GET", "/auth/me"),
  listTeams: () => call<TeamRow[]>("GET", "/teams"),
  addTeam: (name: string) => call<TeamRow>("POST", "/teams", { name }),
  renameTeam: (id: string, name: string) => call<TeamRow>("PUT", `/teams/${encodeURIComponent(id)}`, { name }),
  deleteTeam: (id: string) => call<null>("DELETE", `/teams/${encodeURIComponent(id)}`),
  addMember: (team: string, user: string) => call<TeamRow>("PUT", `/teams/${encodeURIComponent(team)}/members/${encodeURIComponent(user)}`),
  removeMember: (team: string, user: string) => call<TeamRow>("DELETE", `/teams/${encodeURIComponent(team)}/members/${encodeURIComponent(user)}`),
  /** 팀 옮기기 — null이면 공용 */
  getDashboard: (days: number, flow: string | null) => call<DashboardView>("GET", `/dashboard?days=${days}${flow ? `&flow=${encodeURIComponent(flow)}` : ""}`),
  // ── API 토큰(밖에서 부를 때) — 토큰 값은 만들 때 한 번만 온다
  listApiTokens: () => call<ApiTokenRow[]>("GET", "/tokens"),
  addApiToken: (t: { name: string; role: Role; days: number | null }) => call<{ token: string; row: ApiTokenRow }>("POST", "/tokens", t),
  deleteApiToken: (id: string) => call<null>("DELETE", `/tokens/${encodeURIComponent(id)}`),
  /** 노드 출력 고정(pin data) · 풀기 — 초안 시험에서만 쓰인다 */
  setPin: (flowId: string, nodeId: string, output: Record<string, unknown>) => call<{ pins: Record<string, Record<string, unknown>> }>("PUT", `/flows/${encodeURIComponent(flowId)}/pins/${encodeURIComponent(nodeId)}`, { output }),
  unpin: (flowId: string, nodeId: string) => call<{ pins: Record<string, Record<string, unknown>> }>("DELETE", `/flows/${encodeURIComponent(flowId)}/pins/${encodeURIComponent(nodeId)}`),
  /** 게시된 버전 한 번에 — 실행 폼이 입력 칸을 그린다 */
  getPublished: (id: string) => call<Server.PublishedFlow>("GET", `/flows/${encodeURIComponent(id)}/published`),
  /** 승인 기다리기 — 이 실행이 기다리는 승인 · 답하기 · 기다리는 것 전부 */
  getApproval: (runId: string) => call<PendingApproval | null>("GET", `/runs/${encodeURIComponent(runId)}/approval`),
  answerApproval: (runId: string, approved: boolean, comment: string) => call<{ ok: true }>("POST", `/runs/${encodeURIComponent(runId)}/approval`, { approved, comment }),
  listApprovals: () => call<PendingApproval[]>("GET", "/approvals"),
  /** 팀 공용 값 — flow를 주면 그 플로우가 닿는 범위(제 팀 · 공용)만. scope "_"는 공용 */
  listShared: (flow?: string) => call<{ teams: { id: string; name: string }[]; values: SharedValue[] }>("GET", `/shared${flow ? `?flow=${encodeURIComponent(flow)}` : ""}`),
  putSharedVar: (scope: string, name: string, value: string, description: string) => call<unknown>("PUT", `/shared/${encodeURIComponent(scope || "_")}/vars/${encodeURIComponent(name)}`, { value, description }),
  putSharedSecret: (scope: string, name: string, kind: "text" | "login", value: unknown, description: string) => call<unknown>("PUT", `/shared/${encodeURIComponent(scope || "_")}/secrets/${encodeURIComponent(name)}`, { kind, value, description }),
  deleteShared: (scope: string, kind: "var" | "secret", name: string) => call<null>("DELETE", `/shared/${encodeURIComponent(scope || "_")}/${kind === "var" ? "vars" : "secrets"}/${encodeURIComponent(name)}`),
  // ── Suite(테스트)
  listSuites: () => call<SuiteSummary[]>("GET", "/suites"),
  createSuite: (name: string, team: string | null) => call<SuiteView>("POST", "/suites", { name, team }),
  getSuite: (id: string) => call<SuiteDetail>("GET", `/suites/${encodeURIComponent(id)}`),
  saveSuite: (id: string, s: Partial<Pick<SuiteView, "name" | "description" | "items" | "schedules" | "notify">> & { team?: string | null }) => call<SuiteView>("PUT", `/suites/${encodeURIComponent(id)}`, s),
  deleteSuite: (id: string) => call<null>("DELETE", `/suites/${encodeURIComponent(id)}`),
  runSuite: (id: string, item: string | null) => call<{ suiteRunId: string }>("POST", `/suites/${encodeURIComponent(id)}/runs`, item ? { item } : {}),
  getSuiteRun: (id: string) => call<SuiteRunView>("GET", `/suite-runs/${encodeURIComponent(id)}`),
  cancelSuiteRun: (id: string) => call<{ cancelling: boolean }>("POST", `/suite-runs/${encodeURIComponent(id)}/cancel`),
  /** 같은 입력 · 같은 버전으로 다시 */
  /** 같은 입력으로 다시 — version이면 그 버전으로 · from이면 그 단계부터(앞 단계는 그 실행의 출력) */
  rerun: (runId: string, opts: { version?: number | "draft"; from?: string } = {}) => call<{ runId: string; version: number | null }>("POST", `/runs/${encodeURIComponent(runId)}/rerun`, opts),
  /** 여기서부터 다시 — 미리 보기(지난 출력을 쓰는 단계 · 다시 도는 앞 단계) */
  resumePlan: (runId: string, from: string) => call<{ from: string; reused: string[]; again: { id: string; why: "browser" | "masked" }[] } | { error: string }>("GET", `/runs/${encodeURIComponent(runId)}/resume-plan?from=${encodeURIComponent(from)}`),
  listWorkers: () => call<WorkersView>("GET", "/workers"),
  listPlugins: () => call<PluginsView>("GET", "/plugins"),
  /** 같은 사이트를 다루는 워크플로우의 웹페이지 노드 — AI가 녹화해 둔 요소를 다시 쓴다(ai/refs.ts) */
  aiSiteFlows: (hosts: string[]) => call<{ flows: import("./ai/refs.ts").SiteFlow[] }>("GET", `/ai/site-flows?hosts=${encodeURIComponent(hosts.join(","))}`),
  /** AI가 사이트를 본다(관리자가 켰을 때) — 열기 · 다시 보기 · 닫기 */
  aiBrowseOpen: (url: string) => call<{ id: string; snapshot: { url: string; title: string; elements: import("./ai/refs.ts").PageElement[] }; shot: string }>("POST", "/ai/browse", { url }),
  aiBrowseLook: (id: string) => call<{ id: string; snapshot: { url: string; title: string; elements: import("./ai/refs.ts").PageElement[] }; shot: string }>("POST", `/ai/browse/${encodeURIComponent(id)}/look`),
  aiBrowseClose: (id: string) => call<null>("DELETE", `/ai/browse/${encodeURIComponent(id)}`),
  /** AI가 보는 화면에서 한 가지(누르기 · 넣기 · 고르기 · 키) — 값의 {{ $secrets.x }}는 서버가 flowId의 시크릿으로 */
  aiBrowseAct: (id: string, a: { kind: string; target?: unknown; value?: string; key?: string; flowId?: string | null; forbidden?: string[] }) =>
    call<{ id: string; snapshot: { url: string; title: string; elements: import("./ai/refs.ts").PageElement[] }; shot: string }>("POST", `/ai/browse/${encodeURIComponent(id)}/act`, a),
  /** 만든 워크플로우를 점검 실행으로 돌려 본다(AI가 스스로 고치게) */
  aiTry: (p: { draft: unknown; flowId: string | null; params: Record<string, string> }) => call<import("./ai/agent.ts").TryResult>("POST", "/ai/try", p),
  aiStatus: () => call<AiStatus>("GET", "/ai"),
  aiConfigure: (p: { apiKey?: string; model?: string; enabled?: boolean; siteView?: boolean }) => call<AiStatus>("PUT", "/ai", p),
  /** 모델에 묻기 — 서버가 키를 쥐고 대신 부른다 */
  /** ★내 AI · 키 · 모델(«내 설정» — 이 브라우저에만)을 머리글로 싣는다 · 서버는 저장하지 않고 넘긴다(Gemini는 서버가 바꿔 부른다) */
  aiMessages: async (req: { system: string; messages: unknown[]; tools?: readonly unknown[]; flowId: string | null }): Promise<unknown> => {
    const provider = myAiProvider(), key = myAiKey(provider), model = myAiModel(provider);
    const headers: Record<string, string> = { "content-type": "application/json", "x-flowsmith-ai-provider": provider, ...(key ? { "x-flowsmith-ai-key": key } : {}), ...(model ? { "x-flowsmith-ai-model": model } : {}) };
    const r = await fetch("/api/ai/messages", { method: "POST", headers, body: JSON.stringify(req) });
    const data = await r.json().catch(() => null) as { error?: string; problems?: string[] } | null;
    if (r.status === 401) dispatchEvent(new Event("flowsmith:login-required"));
    if (!r.ok) throw new ApiError(r.status, data?.error ?? `요청 실패 (${r.status})`, data?.problems ?? []);
    return data;
  },
  /** 묶음(.fspkg) 그대로 올린다 */
  uploadPlugin: async (file: Blob): Promise<PluginView> => {
    const r = await fetch("/api/plugins", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: file });
    const data = await r.json().catch(() => null) as { error?: string; problems?: string[] } | null;
    if (r.status === 401) dispatchEvent(new Event("flowsmith:login-required"));
    if (!r.ok) throw new ApiError(r.status, data?.error ?? `요청 실패 (${r.status})`, data?.problems ?? []);
    return data as unknown as PluginView;
  },
  updatePlugin: (id: string, p: { enabled?: boolean; version?: string }) => call<PluginView>("PUT", `/plugins/${encodeURIComponent(id)}`, p),
  deletePlugin: (id: string) => call<null>("DELETE", `/plugins/${encodeURIComponent(id)}`),
  setPluginSource: (url: string | null) => call<{ source: string | null }>("PUT", "/plugins-source", { url }),
  checkPluginSource: () => call<{ url: string; plugins: PluginSourceEntry[] }>("POST", "/plugins-source/check"),
  installFromSource: (id: string, version: string) => call<PluginView>("POST", "/plugins-source/install", { id, version }),
  addWorker: (w: { name: string; labels: string; slots: number; team: string | null; kind: "shared" | "personal"; owner: string | null }) => call<{ worker: WorkerRow; token: string }>("POST", "/workers", w),
  updateWorker: (id: string, p: { name?: string; labels?: string; slots?: number; enabled?: boolean }) => call<WorkerRow>("PUT", `/workers/${encodeURIComponent(id)}`, p),
  renewWorkerToken: (id: string) => call<{ token: string }>("POST", `/workers/${encodeURIComponent(id)}/token`),
  deleteWorker: (id: string) => call<null>("DELETE", `/workers/${encodeURIComponent(id)}`),
  setRunOn: (id: string, on: string | null) => call<{ runOn: string | null }>("PUT", `/flows/${encodeURIComponent(id)}/run-on`, { on }),
  setFlowTeam: (id: string, team: string | null) => call<FlowDetail>("PUT", `/flows/${encodeURIComponent(id)}/team`, { team }),
  /** 여럿을 한 묶음으로(null이면 묶음 없음) */
  setFlowGroup: (ids: string[], group: string | null) => call<{ ids: string[]; group: string | null }>("PUT", "/flow-group", { ids, group }),
  // 화면 규칙 — 주소 앞부분 → 화면 이름(목록이 이 이름으로 묶는다)
  listAreas: () => call<Server.AreaRule[]>("GET", "/areas"),
  setAreas: (areas: Server.AreaRule[]) => call<Server.AreaRule[]>("PUT", "/areas", { areas }),
  setup: (b: { token: string; email: string; name: string; password: string }) => call<{ user: User }>("POST", "/auth/setup", b),
  login: (email: string, password: string) => call<{ user: User }>("POST", "/auth/login", { email, password }),
  logout: () => call<null>("POST", "/auth/logout"),
  changePassword: (current: string, next: string) => call<{ ok: true }>("POST", "/auth/password", { current, next }),
  listUsers: () => call<User[]>("GET", "/users"),
  addUser: (b: { email: string; name: string; role: Role }) => call<{ user: User; tempPassword: string }>("POST", "/users", b),
  updateUser: (id: string, b: { name?: string; role?: Role; disabled?: boolean }) => call<User>("PUT", `/users/${encodeURIComponent(id)}`, b),
  resetUser: (id: string) => call<{ tempPassword: string }>("POST", `/users/${encodeURIComponent(id)}/reset`),

  listFlows: () => call<FlowSummary[]>("GET", "/flows"),
  /** team — 둘 팀(없으면 공용) */
  createFlow: (draft: unknown, team: string | null = null) => call<FlowDetail>("POST", "/flows", { draft, team }),
  getFlow: (id: string) => call<FlowDetail>("GET", `/flows/${encodeURIComponent(id)}`),
  /** 그 버전의 매니페스트 — 실행 기록이 그 실행의 캔버스를 그린다 */
  getVersionJson: (id: string, version: number) => call<unknown>("GET", `/flows/${encodeURIComponent(id)}/versions/${version}`),
  saveDraft: (id: string, draft: unknown) => call<FlowDetail>("PUT", `/flows/${encodeURIComponent(id)}/draft`, { draft }),
  deleteFlow: (id: string) => call<null>("DELETE", `/flows/${encodeURIComponent(id)}`),
  /** 복제 — 초안만 새 워크플로우로(버전 · 실행 기록 · 시크릿 값은 안 가져간다) */
  duplicateFlow: (id: string, name?: string) => call<FlowDetail>("POST", `/flows/${encodeURIComponent(id)}/duplicate`, name ? { name } : {}),
  createVersion: (id: string, note: string) => call<{ version: number }>("POST", `/flows/${encodeURIComponent(id)}/versions`, { note }),
  deploy: (id: string, version: number | null) => call<{ activeVersion: number | null }>("POST", `/flows/${encodeURIComponent(id)}/deploy`, { version }),
  listSecrets: (id: string) => call<SecretStatus[]>("GET", `/flows/${encodeURIComponent(id)}/secrets`),
  putSecret: (id: string, name: string, value: unknown) => call<{ stored: boolean }>("PUT", `/flows/${encodeURIComponent(id)}/secrets/${encodeURIComponent(name)}`, { value }),
  deleteSecret: (id: string, name: string) => call<null>("DELETE", `/flows/${encodeURIComponent(id)}/secrets/${encodeURIComponent(name)}`),
  /** part — 초안을 일부만(그 노드 앞까지 · 그 노드까지) · on — 이번만 어디서(「server」 · 「worker:<id>」 · 「label:<라벨>」) */
  /** part.resetWallet — 지갑 브라우저: 그 지갑의 프로필을 지우고 처음부터 준비한 뒤 돈다 */
  startRun: (id: string, version: number | "draft" | undefined, params: Record<string, string>, part?: { stopBefore?: string; stopAfter?: string; on?: string; resetWallet?: boolean }) =>
    call<{ runId: string }>("POST", `/flows/${encodeURIComponent(id)}/runs`, { ...(version === undefined ? {} : { version }), params, ...(part ?? {}) }),
  listRuns: (id: string) => call<RunRow[]>("GET", `/flows/${encodeURIComponent(id)}/runs?limit=20`),
  getRun: (runId: string) => call<RunRow>("GET", `/runs/${encodeURIComponent(runId)}`),
  /** 멈추기 — 그 실행이 부른 실행도 함께 멈춘다 */
  cancelRun: (runId: string) => call<{ cancelling: boolean }>("POST", `/runs/${encodeURIComponent(runId)}/cancel`),
  listProbes: (id: string) => call<ProbeRow[]>("GET", `/flows/${encodeURIComponent(id)}/probes`),
  startProbe: (id: string, version?: number | "draft") => call<{ probeId: string }>("POST", `/flows/${encodeURIComponent(id)}/probes`, version === undefined ? {} : { version }),
  getProbe: (probeId: string) => call<ProbeRow>("GET", `/probes/${encodeURIComponent(probeId)}`),
  getWebhook: (id: string) => call<{ enabled: boolean; createdAt: string | null; path: string }>("GET", `/flows/${encodeURIComponent(id)}/webhook`),
  enableWebhook: (id: string) => call<{ token: string; createdAt: string; path: string }>("POST", `/flows/${encodeURIComponent(id)}/webhook`),
  disableWebhook: (id: string) => call<null>("DELETE", `/flows/${encodeURIComponent(id)}/webhook`),
  listFiles: (dir: string) => call<{ root: string; dir: string; entries: FileEntry[] }>("GET", `/files?dir=${encodeURIComponent(dir)}`),
  /** 파일 쓰기 노드의 폴더 — 이 플로우 폴더(서버가 아는 uid) · 공유 폴더 */
  listStoreFiles: (flowId: string, scope: "flow" | "shared", dir: string) =>
    call<{ root: string; dir: string; entries: FileEntry[] }>("GET", `/files?flow=${encodeURIComponent(flowId)}&scope=${scope}&dir=${encodeURIComponent(dir)}`),
  previewFile: (path: string) => call<{ path: string; size: number; text: string; truncated: boolean }>("GET", `/files/preview?path=${encodeURIComponent(path)}`),
  deleteFile: (path: string) => call<null>("DELETE", `/files?path=${encodeURIComponent(path)}`),
  /** 이 서버가 메일을 보낼 수 있나(SMTP가 정해졌나) */
  notifyConfig: () => call<{ email: boolean; from: string | null }>("GET", "/notify/config"),
  listNotices: (id: string) => call<NoticeRow[]>("GET", `/flows/${encodeURIComponent(id)}/notices`),
  /** 시험 알림 — 저장된 초안의 변수 · 시크릿으로 주소를 채운다 */
  testNotify: (id: string, rule: NotifyRule) => call<{ ok: boolean; status: number | null; error: string }>("POST", `/flows/${encodeURIComponent(id)}/notify/test`, { rule }),
  downloadUrl: (path: string) => `/api/files/download?path=${encodeURIComponent(path)}`,
  /** 엑셀로 바꿔 받기 — CSV · JSON Lines · JSON */
  xlsxUrl: (path: string) => `/api/files/download?path=${encodeURIComponent(path)}&as=xlsx`,
  canXlsx: (name: string) => /\.(csv|jsonl|json)$/i.test(name),

  /** 진행을 받는다. 끝나면(run:end) 스스로 닫는다. 돌려주는 함수로 일찍 끊을 수 있다 */
  watchRun(runId: string, on: (e: Watch) => void): () => void {
    const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
    const kinds: Watch["kind"][] = ["node:start", "step", "log", "node:end", "run:end", "run:queued", "run:placed", "run:locked", "human", "approval"];
    for (const k of kinds) {
      es.addEventListener(k, (m) => {
        const e = JSON.parse((m as MessageEvent<string>).data) as Watch;
        on(e);
        if (e.kind === "run:end") es.close();
      });
    }
    es.onerror = () => es.close();
    return () => es.close();
  },
};

import type { ExtensionMeta } from "./ext-meta.ts";
export type { ExtensionMeta };

let extensionsOnce: Promise<ExtensionMeta[]> | null = null;
/** 한 번만 물어본다 — 플러그인을 바꾸면(«확장» 화면) forgetExtensions로 다시 묻게 한다 */
export function listExtensions(): Promise<ExtensionMeta[]> {
  extensionsOnce ??= call<ExtensionMeta[]>("GET", "/extensions").catch(() => { extensionsOnce = null; return []; });
  return extensionsOnce;
}
/** 플러그인을 올리거나 바꾼 뒤 — 노드 목록을 새로 받게 */
export function forgetExtensions(): void { extensionsOnce = null; }
