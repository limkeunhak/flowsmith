/**
 * **실행기** — 플로우 하나를 처음부터 끝까지 돌린다.
 *
 *   검문소를 통과한 Flow + 실행 입력 + 시크릿 값 → RunResult
 *
 * 무엇을 다음에 돌릴지는 core의 `RunState`가 정한다. 여기는 노드를 «어떻게» 돌릴지만 안다.
 * ★저장소를 모른다 — 받은 것만으로 돈다(PLAN §4.1). 서버 안의 워커와 사람 PC의 워커(packages/worker)가 똑같이 부른다.
 *
 * ★★**가림**: 받은 시크릿 값은 결과 · 단계 기록 · 로그 · 실패 메시지 **어디에도** 그대로 나가지 않는다.
 *  내보내는 길이 `emit`과 `finish` 둘뿐이고, 둘 다 `redact`를 거친다.
 */
import { randomUUID } from "node:crypto";
import type { Browser, Page } from "playwright";
import {
  BLOCKED_PORT, checkSummary, compile, decide, evaluate, runChecks, httpSafe, paramProblem, redact, RunState, withParamDefaults,
  reportStatus, walletSecretName,
  type CheckResult, type ExtensionNode, type Flow, type FlowNode, type NodeStatus, type Output, type ProbeFinding, type ProbeReport, type Scope, type SecretValue,
} from "@flowsmith/core";
import { probeReport, ProbeStop } from "./probe.ts";
import { BrowserSession, type AppView } from "./browser/browser-session.ts";
import type { ExtensionRegistry } from "./extensions.ts";
import { RunStopped, StepError, toFailure, type StepFailure } from "./errors.ts";
import { Primitives } from "./browser/primitives.ts";
import { runWebNode, type StepLog } from "./nodes/web-node.ts";
import { runCustomNode } from "./nodes/custom-node.ts";
import { runFileWriteNode, type FileStoreOptions } from "./nodes/file-write-node.ts";
import { runZipNode } from "./nodes/zip-node.ts";
import { runFileReadNode } from "./nodes/file-read-node.ts";
import { runExtensionNode } from "./nodes/extension-node.ts";
import { runFlowCallNode, type CallFlow } from "./nodes/flow-call-node.ts";
import { runHttpNode } from "./nodes/http-node.ts";
import { runTransformNode } from "./nodes/transform-node.ts";
import { runApprovalNode, type ApprovalState, type AskApproval } from "./nodes/approval-node.ts";
import { enginePolicy } from "./policy.ts";
import { installWallet } from "./browser/wallet.ts";
import { openWalletBrowser, type MetaMaskEnv } from "./browser/metamask/wallet-browser.ts";
import { approveUntil, ensureChain } from "./browser/metamask/approve.ts";

export interface RunOptions {
  /** 서버가 실행 기록의 id를 먼저 정했으면 그것을 쓴다 */
  runId?: string;
  params?: Record<string, string>;
  secrets?: Record<string, SecretValue>;
  /** 주면 그 브라우저를 쓰고 닫지 않는다(시험 · 워커가 브라우저를 다시 쓸 때). 안 주면 띄우고 닫는다 */
  browser?: Browser;
  /** 주면 그 페이지에서 돈다(레코더가 녹화 전에 앞 단계를 재생할 때). 컨텍스트를 만들지도 닫지도 않는다 */
  page?: Page;
  /** 이 노드 앞에서 멈춘다 — 그 노드가 받을 입력을 `stoppedAt`에 담는다 */
  stopBefore?: string;
  /** 이 노드까지 돌리고 멈춘다 — 편집 화면의 «이 단계까지 실행»(뒤 노드는 «대기»로 남는다) */
  stopAfter?: string;
  headless?: boolean;
  /** 사람의 크롬 CDP 주소 — 플로우가 attach일 때 · 확장이 붙을 때 (기본 http://127.0.0.1:9222) */
  cdpUrl?: string;
  /**
   * 지갑 브라우저(browser: "wallet")에 쓸 것 — 워커가 준다: MetaMask를 풀어 둔 폴더 · 지갑 프로필 뿌리(PLAN §44).
   * 없으면 지갑 브라우저 플로우는 브라우저를 열 때 멈춘다(화면이 없는 워커)
   */
  metamask?: MetaMaskEnv;
  /** 앱 안 브라우저(browser: "app")의 뷰를 연다 — 데스크톱 앱의 워커가 준다. 없으면 그 플로우는 브라우저를 열 때 멈춘다 */
  openApp?: () => Promise<AppView>;
  /** 이 워커에 설치된 확장들 */
  extensions?: ExtensionRegistry;
  /** 점검 실행 — 요소를 녹화 때와 견주고, 되돌릴 수 없는 동작 앞에서 멈춘다. 결과에 `probe` 보고서가 붙는다 */
  probe?: boolean;
  /** 파일 쓰기 노드가 파일을 쓰는 곳(파일 뿌리). 없으면 파일 파일 쓰기 노드는 멈춘다 */
  files?: FileStoreOptions;
  /** 다른 플로우 실행 노드가 부른다 — 서버가 준다. 없으면 그 노드는 멈춘다 */
  callFlow?: CallFlow;
  /** 멈추기 — 켜지면 지금 동작을 깨우고 다음 노드 · 동작 앞에서 끝낸다(결과는 «멈춤») */
  signal?: AbortSignal;
  /** 실행 전체 시간 제한(ms) — 주면 플로우 설정(runTimeoutMin)보다 이것. null이면 없음 */
  timeoutMs?: number | null;
  /**
   * 사람이 이 실행의 화면을 만질 수 있나 — «사람 기다리기»가 기다릴지 · 바로 멈출지.
   * 없으면: 사람의 크롬(attach)이거나 레코더가 준 페이지(녹화 — 사람이 그 화면에 있다)일 때만 그렇다고 본다.
   * 서버는 실행 화면(조작)이 있어 true를 준다(packages/worker local.ts)
   */
  human?: boolean;
  /**
   * **고정된 출력**(n8n의 pin data) — 이 노드들은 돌지 않고 이 값을 내놓는다. 서버가 초안 시험 · 여기서부터 다시(앞 실행의 출력 — core planResume)에만 준다.
   * 뒤 노드(값 다듬기 · 파일 · HTTP)를 만들 때 사이트를 다시 돌지 않게. 조건 노드는 고정하지 않는다(갈래를 골라야 한다)
   */
  pins?: Record<string, Output>;
  /** 승인 기다리기 — 서버가 준다(묻고 답을 기다린다). 없으면 그 노드는 멈춘다 */
  approval?: AskApproval;
  /** 검사가 불통과면 그때의 페이지를 한 장 찍는다(기본 켬) — ★불통과일 때만 · 한 실행에 한 장 */
  shotOnCheckFail?: boolean;
  /** 노드들이 쓰는 페이지가 바뀌면(새 페이지 · 팝업 · 돌아옴) — 실행 화면 보기가 이것을 따라간다 */
  onPage?: (page: Page) => void;
  onEvent?: (e: RunEvent) => void;
}

export interface NodeRun {
  id: string;
  name: string;
  type: FlowNode["type"];
  status: NodeStatus;
  input: Output | null;
  output: Output | null;
  /** 조건 노드가 고른 갈래 */
  branch: string | null;
  steps: StepLog[];
  logs: string[];
  failure: StepFailure | null;
  ms: number;
  /** 이 노드가 시작한 때 — 실행 시간표(Airflow의 Gantt처럼). 돌지 않았으면 null */
  startedAt: string | null;
  /** 고정된 출력을 썼나(돌지 않았다) */
  pinned?: boolean;
  /** 검사 노드 — 항목마다의 판정(기대 · 실제) */
  checks?: CheckResult[];
}

export interface RunResult {
  runId: string;
  flowId: string;
  /** cancelled — 사람이 멈췄다(전체 시간 제한을 넘은 것은 failure) · blocked — 고르면 안 되는 행에 걸려 막힘 갈래로 끝났다 */
  status: "success" | "failure" | "cancelled" | "blocked";
  message: string;
  output: Output;
  nodes: NodeRun[];
  startedAt: string;
  ms: number;
  /** stopBefore로 멈췄으면 — 그 노드와, 그 노드가 받았을 입력 */
  stoppedAt?: { nodeId: string; input: Output };
  /** 점검 실행이면 */
  probe?: ProbeReport;
  /** 검사가 불통과였을 때 그때의 페이지(한 장) — 서버가 떼어 따로 둔다(실행 기록 본문에는 남기지 않는다) */
  shot?: { nodeId: string; mime: "image/jpeg"; data: string };
}

export type RunEvent =
  | { kind: "node:start"; nodeId: string; input: Output }
  | { kind: "step"; nodeId: string; step: StepLog }
  | { kind: "log"; nodeId: string; text: string }
  | { kind: "node:end"; node: NodeRun }
  /** 사람 기다리기 — 기다림(waiting · 언제까지) · 끝(done · timeout · stopped · failed) */
  | { kind: "human"; nodeId: string; actionId: string; index: number; state: "waiting" | "done" | "timeout" | "stopped" | "failed"; prompt: string; deadline: string | null }
  /** 승인 기다리기 — 기다림(waiting · 언제까지 · 누가 할 수 있나) · 끝(approved · rejected · timeout · stopped — 누가 · 한마디) */
  | { kind: "approval"; nodeId: string; state: ApprovalState; message: string; minRole: "runner" | "editor" | "admin"; deadline: string | null; by?: string | null; comment?: string };

export class RunInputError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`실행할 수 없습니다:\n- ${problems.join("\n- ")}`);
    this.name = "RunInputError";
    this.problems = problems;
  }
}

/** 실행 전에 — 입력과 시크릿이 다 있나. 브라우저를 띄우기 전에 멈춘다 */
export function checkRunInputs(flow: Flow, params: Record<string, string>, secrets: Record<string, SecretValue>): string[] {
  const problems: string[] = [];
  for (const p of flow.params) {
    const v = params[p.name] ?? "";
    if (p.required && v.trim() === "") { problems.push(`실행 입력 '${p.label}'(${p.name})가 없습니다`); continue; }
    // 종류 — 비어 있지 않으면 맞아야 한다(숫자 · 날짜 · 보기 중 하나)
    const bad = v.trim() !== "" ? paramProblem(p, v) : null;
    if (bad) problems.push(`실행 입력 '${p.label}'(${p.name}): ${bad}`);
  }
  for (const s of flow.secrets) {
    const v = secrets[s.name];
    if (v === undefined) { problems.push(`시크릿 '${s.name}'의 값이 저장되지 않았습니다`); continue; }
    if (s.kind === "text" && typeof v !== "string") problems.push(`시크릿 '${s.name}'은 글자 하나여야 합니다`);
    if (s.kind === "login" && (typeof v === "string" || typeof v.username !== "string" || typeof v.password !== "string")) {
      problems.push(`시크릿 '${s.name}'에 username과 password가 있어야 합니다`);
    }
  }
  return problems;
}

/** 개인정보를 가린 자리 */
export const PII_MASK = "«개인정보 — 기록하지 않음»";

const secretStrings = (secrets: Record<string, SecretValue>): string[] =>
  Object.values(secrets).flatMap((v) => (typeof v === "string" ? [v] : Object.values(v)));

export async function runFlow(flow: Flow, opts: RunOptions = {}): Promise<RunResult> {
  const params = withParamDefaults(flow.params, opts.params ?? {});
  const secrets = opts.secrets ?? {};
  const inputProblems = checkRunInputs(flow, params, secrets);
  if (inputProblems.length > 0) throw new RunInputError(inputProblems);

  const hide = secretStrings(secrets);
  const emit = (e: RunEvent) => opts.onEvent?.(redact(e, hide));

  const compiled = compile(flow);
  const state = new RunState(compiled);
  const runId = opts.runId ?? randomUUID();
  const startedAt = new Date();
  const records = new Map<string, NodeRun>(flow.nodes.map((n) => [n.id, {
    id: n.id, name: n.name, type: n.type, status: "pending", input: null, output: null, branch: null, steps: [], logs: [], failure: null, ms: 0, startedAt: null,
  }]));

  // 지갑이 한 일은 그때 도는 노드의 기록에 남는다
  let walletNode: string | null = null;
  const walletLog = (text: string) => { const r = walletNode ? records.get(walletNode) : undefined; if (r) { r.logs.push(text); emit({ kind: "log", nodeId: r.id, text }); } };
  const wallet = flow.settings.wallet;
  // 키 시크릿 — 실행 입력으로 고를 수 있다(두 지갑이 차례를 주고받는 거래 · core wallet.ts)
  const walletSecret = wallet ? walletSecretName(wallet.secret, params, flow.params) : "";
  if (wallet && walletSecret !== wallet.secret && !flow.secrets.some((x) => x.name === walletSecret)) {
    throw new RunInputError([`지갑: 실행 입력이 고른 시크릿 "${walletSecret}"은(는) 이 워크플로우의 시크릿이 아닙니다`]);
  }
  // 지갑 브라우저(MetaMask) — 처음 필요할 때 연다. 키는 여기서만 풀린다
  const mm = flow.settings.browser === "wallet" && wallet?.mode === "metamask" ? wallet : null;
  const mmEnv = opts.metamask;
  const openWallet = mm && mmEnv ? async () => {
    const key = secrets[walletSecret];
    if (typeof key !== "string") throw new Error(`MetaMask 지갑: 시크릿 "${walletSecret}"에 키가 없습니다`);
    return openWalletBrowser(mmEnv, key, { log: walletLog });
  } : undefined;
  // 브라우저는 처음 필요할 때 마련한다 — 띄우거나(launch) 사람의 크롬에 붙거나(attach) 지갑 브라우저를 연다(wallet)
  const session = new BrowserSession(flow.settings.browser, {
    ...(opts.browser ? { browser: opts.browser } : {}), ...(opts.page ? { page: opts.page } : {}),
    ...(opts.headless !== undefined ? { headless: opts.headless } : {}), ...(opts.cdpUrl ? { cdpUrl: opts.cdpUrl } : {}),
    ...(openWallet ? { openWallet } : {}),
    ...(opts.openApp && flow.settings.browser === "app" ? { openApp: opts.openApp } : {}),
  });
  let chainReady = false;
  const walletBase = (page: Page) => {
    const context = session.context;
    if (!context) throw new Error("지갑 브라우저가 열려 있지 않습니다");
    return { context, dapp: page, wallet: mm!, probe: opts.probe ?? false, signal: stop.signal, log: walletLog };
  };
  // 처음 한 번 — 워크플로우의 처음 체인으로(사이트 페이지에 지갑이 들어온 뒤에야 부를 수 있다)
  const prepareChain = async (page: Page) => { if (!chainReady) { await ensureChain(walletBase(page)); chainReady = true; } };
  const walletHook = mm ? {
    prepare: prepareChain,
    approve: async (page: Page, done: () => Promise<boolean>, timeoutMs: number, atLeast?: number) => {
      await prepareChain(page);   // «앞 페이지에서 이어서»로만 시작했으면 여기서
      return (await approveUntil({ ...walletBase(page), done, timeoutMs, ...(atLeast ? { atLeast } : {}) })).length;
    },
  } : null;
  // 테스트 지갑(페이지에 넣는 것) — 우리가 띄운 브라우저에만(core wallet.ts)
  if (wallet && wallet.mode === "inject") {
    const key = secrets[walletSecret];
    session.onContext = async (ctx) => {
      if (typeof key !== "string") throw new Error(`테스트 지갑: 시크릿 "${walletSecret}"에 개인키가 없습니다`);
      await installWallet(ctx, wallet, key, { probe: opts.probe ?? false, log: walletLog });
    };
  }
  if (opts.onPage) {
    session.onCurrent = opts.onPage;
    if (session.page) opts.onPage(session.page);
  }
  // 멈추기 · 전체 시간 제한 — 하나의 신호로. 켜지면 하던 브라우저 일을 깨우고 다음 자리에서 끝낸다
  const stop = new AbortController();
  let stopped: { kind: "cancel" | "timeout"; message: string } | null = null;
  const halt = (why: NonNullable<typeof stopped>) => {
    if (stopped) return;
    stopped = why;
    stop.abort();
    void session.interrupt();
  };
  const onCancel = () => halt({ kind: "cancel", message: "실행을 멈췄습니다(사람이 멈춤)" });
  if (opts.signal?.aborted) onCancel();
  opts.signal?.addEventListener("abort", onCancel, { once: true });
  const limitMs = opts.timeoutMs !== undefined ? opts.timeoutMs : flow.settings.runTimeoutMin !== null ? flow.settings.runTimeoutMin * 60_000 : null;
  const timer = limitMs !== null ? setTimeout(() => halt({ kind: "timeout", message: `전체 시간 제한(${limitMs >= 60_000 ? `${Math.round(limitMs / 60_000)}분` : `${Math.round(limitMs / 1000)}초`})을 넘어 멈췄습니다` }), limitMs) : null;
  let stoppedNode: string | null = null;
  // ★개인정보 — 확장이 그렇다고 한 이름은 기록 · 이벤트 · 결과에서 가린다(다음 노드에는 진짜 값이 간다)
  const piiKeys = new Set<string>();
  const hidePii = (o: Output): Output => (piiKeys.size === 0 ? o : Object.fromEntries(Object.entries(o).map(([k, v]) => [k, piiKeys.has(k) ? PII_MASK : v])));
  const prims = new WeakMap<Page, Primitives>();
  const primFor = (p: Page) => { let x = prims.get(p); if (!x) prims.set(p, (x = new Primitives(p, flow.settings.forbiddenLabels))); return x; };
  let stoppedAt: RunResult["stoppedAt"];
  let stoppedAfter: string | null = null;
  const findings: ProbeFinding[] = [];
  let probeStop: ProbeStop | null = null;
  let shot: RunResult["shot"];
  const humanOk = !opts.probe && (opts.human ?? (flow.settings.browser === "attach" || flow.settings.browser === "app" || opts.page !== undefined));

  try {
    for (let job = state.next(); job !== null; job = state.next()) {
      const { node, input } = job;
      if (stopped) { stoppedNode = node.id; break; }
      if (node.id === opts.stopBefore) {
        stoppedAt = { nodeId: node.id, input };
        break;
      }
      const rec = records.get(node.id)!;
      walletNode = node.id;
      rec.input = hidePii(input);
      const t0 = Date.now();
      rec.startedAt = new Date(t0).toISOString();
      emit({ kind: "node:start", nodeId: node.id, input: rec.input });
      const scope: Scope = { input, nodes: state.outputs, params, vars: flow.vars, secrets };
      try {
        if (opts.probe) {
          // 무엇을 할지 미리 알 수 없는 노드 · 되돌릴 수 없는 확장 앞에서 멈춘다
          if (node.type === "custom" && node.config.usesPage) throw new ProbeStop(node.id, null, "페이지를 쓰는 커스텀 노드 앞에서 멈췄습니다 — 무엇을 할지 미리 알 수 없습니다");
          if (node.type === "flowCall") throw new ProbeStop(node.id, null, "다른 워크플로우 실행 앞에서 멈췄습니다 — 점검은 다른 워크플로우를 돌리지 않습니다");
          if (node.type === "http" && !httpSafe(node.config.method)) throw new ProbeStop(node.id, null, `HTTP ${node.config.method} 요청 앞에서 멈췄습니다 — 점검은 GET · HEAD만 보냅니다`);
          if (node.type === "fileWrite") throw new ProbeStop(node.id, null, "파일 쓰기 노드 앞에서 멈췄습니다 — 점검은 파일을 쓰지 않습니다");
          if (node.type === "zip") throw new ProbeStop(node.id, null, "압축 노드 앞에서 멈췄습니다 — 점검은 파일을 쓰지 않습니다");
          if (node.type === "approval") throw new ProbeStop(node.id, null, "승인 기다리기 앞에서 멈췄습니다 — 점검은 사람에게 승인을 묻지 않습니다");
          if (node.type === "extension" && opts.extensions?.get(node.config.extension)?.risk !== "safe") throw new ProbeStop(node.id, null, "확장 노드 앞에서 멈췄습니다 — 되돌릴 수 없는 일을 하거나 알 수 없는 확장입니다");
        }
        const pin = !opts.probe && node.type !== "condition" ? opts.pins?.[node.id] : undefined;
        if (pin) {
          // 고정된 출력 — 돌지 않고 그 값을 내놓는다(초안 시험). 웹페이지 노드면 페이지도 열리지 않는다
          rec.pinned = true;
          rec.output = pin;
          const log = "고정된 출력을 썼습니다 — 이 노드는 돌지 않았습니다(초안 시험 · 여기서부터 다시)";
          rec.logs.push(log);
          emit({ kind: "log", nodeId: node.id, text: log });
          state.succeed(node.id, pin);
        } else switch (node.type) {
          case "web": {
            const start = node.config.start;
            const page = start.kind === "url" ? await session.pageForUrl()
              : start.kind === "tab" ? await session.tab(start.match)
              : session.page ?? await session.pageForUrl();   // 이어서 — 페이지가 없으면 빈 페이지(노드가 «이어 갈 페이지 없음»으로 멈춘다)
            const output = await runWebNode(node, {
              prim: primFor(page), primFor, onPage: (p, opened) => session.follow(p, opened), openerOf: (p) => session.openerOf(p), scope, defaultTimeoutMs: flow.settings.defaultTimeoutMs,
              signal: stop.signal, retry: { count: flow.settings.retries, delayMs: flow.settings.retryDelayMs },
              ...(opts.files ? { files: opts.files } : {}),
              ...(opts.probe ? { probe: { report: (f) => { findings.push(f); } } } : { actionPause: flow.settings.actionPause }),
              step: (s) => { rec.steps.push(s); emit({ kind: "step", nodeId: node.id, step: s }); },
              ...(walletHook ? { wallet: walletHook } : {}),
              ...(humanOk ? { human: {
                waiting: (w) => emit({ kind: "human", nodeId: node.id, actionId: w.actionId, index: w.index, state: "waiting", prompt: w.prompt, deadline: w.deadline }),
                finished: (w) => emit({ kind: "human", nodeId: node.id, actionId: w.actionId, index: w.index, state: w.outcome, prompt: w.prompt, deadline: null }),
              } } : {}),
            });
            // ★앞 페이지에서 이어서 — 받은 것 위에 이 노드가 읽은 것(노드를 나눠도 앞에서 읽은 값이 뒤로 이어진다 · core graph.ts와 같다)
            const merged = start.kind === "continue" ? { ...input, ...output } : output;
            rec.output = merged;
            state.succeed(node.id, merged);
            break;
          }
          case "condition": {
            const d = decide(node.config, scope);
            rec.output = input;
            rec.branch = d.port;
            const log = `갈래 '${d.label}'(${d.port})${d.then.kind === "end" ? ` → 워크플로우 종료(${d.then.status})` : ""}`;
            rec.logs.push(log);
            emit({ kind: "log", nodeId: node.id, text: log });
            state.succeed(node.id, input, d.port);
            break;
          }
          case "custom": {
            // 사내 서버에서 관리자가 끌 수 있다(main.ts — FLOWSMITH_CUSTOM_CODE=off) — 코드는 서버 안에서 돈다
            if (!enginePolicy.customCode) throw new Error("이 서버는 커스텀(코드) 노드를 돌리지 않습니다 — 관리자가 껐습니다. «값 다듬기» 노드로 바꾸세요");
            const page = node.config.usesPage ? await session.anyPage() : session.page;
            const output = await runCustomNode(node, input, {
              page, context: session.context, params, vars: flow.vars,
              log: (text) => { rec.logs.push(text); emit({ kind: "log", nodeId: node.id, text }); },
            });
            rec.output = output;
            state.succeed(node.id, output);
            break;
          }
          case "extension": {
            const output = await runExtensionNode(node, scope, opts, session.cdpUrl, (text) => { rec.logs.push(text); emit({ kind: "log", nodeId: node.id, text }); }, (k) => piiKeys.add(k));
            rec.output = hidePii(output);
            state.succeed(node.id, output);
            break;
          }
          case "fileRead": {
            const output = await runFileReadNode(node, opts.files, (text) => { rec.logs.push(text); emit({ kind: "log", nodeId: node.id, text }); });
            rec.output = output;
            state.succeed(node.id, output);
            break;
          }
          case "flowCall": {
            const output = await runFlowCallNode(node, scope, opts.callFlow, (text) => { rec.logs.push(text); emit({ kind: "log", nodeId: node.id, text }); }, stop.signal);
            rec.output = output;
            state.succeed(node.id, output);
            break;
          }
          case "transform": {
            const output = runTransformNode(node, scope, (text) => { rec.logs.push(text); emit({ kind: "log", nodeId: node.id, text }); });
            rec.output = output;
            state.succeed(node.id, output);
            break;
          }
          case "http": {
            const output = await runHttpNode(node, {
              scope, defaultTimeoutMs: flow.settings.defaultTimeoutMs, signal: stop.signal,
              retry: { count: flow.settings.retries, delayMs: flow.settings.retryDelayMs },
              log: (text) => { rec.logs.push(text); emit({ kind: "log", nodeId: node.id, text }); },
            });
            rec.output = output;
            state.succeed(node.id, output);
            break;
          }
          case "zip": {
            const output = await runZipNode(node, scope, opts.files, (text) => { rec.logs.push(text); emit({ kind: "log", nodeId: node.id, text }); });
            rec.output = output;
            state.succeed(node.id, output);
            break;
          }
          case "fileWrite": {
            const output = await runFileWriteNode(node, scope, opts.files, (text) => { rec.logs.push(text); emit({ kind: "log", nodeId: node.id, text }); });
            rec.output = output;
            state.succeed(node.id, output);
            break;
          }
          case "check": {
            // 점검(변경 감시)은 판정하지 않는다 — 점검용 입력값으로는 기대값이 맞을 까닭이 없다
            if (opts.probe) {
              rec.output = input;
              rec.logs.push("점검은 검사를 하지 않습니다 — 받은 값을 넘깁니다");
              state.succeed(node.id, input);
              break;
            }
            const results = runChecks(node.config, scope);
            rec.checks = results;
            for (const r of results) {
              const text = `${r.pass ? "✓" : "✗"} ${r.label} — 실제 «${r.actual}»${r.expected !== null ? ` · 기대 «${r.expected}»` : ""}${r.error ? ` · ${r.error}` : ""}`;
              rec.logs.push(text);
              emit({ kind: "log", nodeId: node.id, text });
            }
            const bad = results.filter((r) => !r.pass);
            if (bad.length > 0) {
              // ★불통과일 때만 · 한 실행에 한 장 — 그때의 페이지(없으면 찍지 않는다)
              const page = session.page;
              if (opts.shotOnCheckFail !== false && !shot && page && !page.isClosed()) {
                // 15초 — 바쁜 PC에서 5초로는 가끔 못 찍어 증거가 빠졌다(전체 시험에서 흔들림)
                try { shot = { nodeId: node.id, mime: "image/jpeg", data: (await page.screenshot({ type: "jpeg", quality: 70, timeout: 15_000 })).toString("base64") }; }
                catch { /* 못 찍어도 판정은 그대로 */ }
              }
              throw new StepError({ problem: "check", message: checkSummary(results), label: node.name, locator: null, candidates: [] });
            }
            const output = { ...input, checksPassed: results.length, checksFailed: 0 };
            rec.output = output;
            state.succeed(node.id, output);
            break;
          }
          case "approval": {
            const output = await runApprovalNode(node, scope, opts.approval, (text) => { rec.logs.push(text); emit({ kind: "log", nodeId: node.id, text }); }, stop.signal,
              (st, e) => emit({ kind: "approval", nodeId: node.id, state: st, ...e }));
            rec.output = output;
            state.succeed(node.id, output);
            break;
          }
        }
      } catch (e) {
        if (e instanceof ProbeStop) {
          // ★점검이 여기서 멈춘다 — 실패가 아니다. 이 노드와 뒤는 «안 돎»으로 남는다
          probeStop = e;
          rec.logs.push(`점검 멈춤 — ${e.message}`);
          emit({ kind: "log", nodeId: node.id, text: rec.logs.at(-1)! });
          rec.ms = Date.now() - t0;
          break;
        }
        if (stopped || e instanceof RunStopped) {
          // ★멈춤은 노드 실패가 아니다 — 이 노드와 뒤는 «안 돎»으로 남는다
          stoppedNode = node.id;
          rec.logs.push((stopped as { message: string } | null)?.message ?? "실행을 멈췄습니다");
          emit({ kind: "log", nodeId: node.id, text: rec.logs.at(-1)! });
          rec.ms = Date.now() - t0;
          break;
        }
        rec.failure = toFailure(e);
        // 고르면 안 되는 행 — 막힘 갈래가 이어져 있으면 실패가 아니라 그쪽으로(받은 값 + 막힌 까닭)
        if (rec.failure.problem === "refused" && compiled.outgoing.get(node.id)!.some((x) => x.from.port === BLOCKED_PORT)) {
          const output: Output = { ...input, blockedReason: rec.failure.message };
          rec.output = output;
          const log = `막혔습니다 — ${rec.failure.message} · 막힘 갈래로 이어 갑니다`;
          rec.logs.push(log);
          emit({ kind: "log", nodeId: node.id, text: log });
          state.block(node.id, output, BLOCKED_PORT, rec.failure.message);
        } else state.fail(node.id, rec.failure.message);
      }
      if (rec.output) rec.output = hidePii(rec.output);
      rec.ms = Date.now() - t0;
      rec.status = state.status(node.id);
      emit({ kind: "node:end", node: rec });
      if (node.id === opts.stopAfter) { stoppedAfter = node.id; break; }
    }
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onCancel);
    await session.close();
  }

  const halted = stoppedAt?.nodeId ?? probeStop?.nodeId;
  const stopInfo = stopped as { kind: "cancel" | "timeout"; message: string } | null;
  if (stopInfo) {
    // 멈춤 — 멈춘 노드와 아직 안 돈 노드는 «안 돎»
    for (const r of records.values()) if (r.id === stoppedNode || state.status(r.id) === "pending") r.status = "cancelled"; else r.status = state.status(r.id);
  } else {
    for (const r of records.values()) r.status = halted === r.id ? (probeStop ? "cancelled" : "pending") : state.status(r.id) === "pending" && probeStop ? "cancelled" : state.status(r.id);
  }
  const outcome = state.outcome;
  const result: RunResult = {
    runId,
    flowId: flow.id,
    // 멈춘 실행은 끝나지 않았다 — 실패한 노드가 없으면 «여기까지 성공»이다
    status: stopInfo ? (stopInfo.kind === "cancel" ? "cancelled" : "failure")
      : outcome.status === "blocked" ? "blocked"
      : outcome.status === "success" || (outcome.status === "running" && (stoppedAt !== undefined || probeStop !== null || (stoppedAfter !== null && state.status(stoppedAfter) !== "failed"))) ? "success" : "failure",
    message: stopInfo ? stopInfo.message
      : outcome.status === "running" ? (stoppedAt ? `${stoppedAt.nodeId} 앞에서 멈췄습니다` : stoppedAfter ? `「${records.get(stoppedAfter)!.name}」까지 돌렸습니다` : probeStop ? `점검 멈춤 — ${probeStop.message}` : "") : outcome.message,
    output: outcome.status === "success" || outcome.status === "blocked" ? hidePii(outcome.output) : {},
    nodes: compiled.order.map((id) => records.get(id)!),
    startedAt: startedAt.toISOString(),
    ms: Date.now() - startedAt.getTime(),
    ...(stoppedAt ? { stoppedAt } : {}),
    ...(shot ? { shot } : {}),
    ...(opts.probe ? { probe: probeReport(findings, probeStop, outcome.status === "failure" ? outcome.message : null) } : {}),
  };
  return redact(result, hide);
}
