/**
 * **실행 관리** — 실행을 시작하고, 기록하고, 지켜보는 사람에게 진행을 흘려 준다.
 *
 * 실행은 뒤에서 돈다. 시작하면 id가 바로 나가고, 진행은 `subscribe`(SSE)로, 결과는 저장소로.
 * ★입력 · 시크릿 검사는 **시작하기 전에** 한다 — 잘못된 요청에 실행 기록을 남기지 않는다.
 *
 * 운영(2026-10-16):
 *   멈추기   cancel(runId) — 엔진에 신호를 주고, 그 실행이 부른 실행(다른 플로우 실행)도 함께 멈춘다
 *   동시 한도 서버 전체에서 동시에 도는 실행 수(maxConcurrent). 넘으면 차례를 기다린다(먼저 온 차례로).
 *            ★다른 플로우가 부른 실행은 부른 실행의 자리를 함께 쓴다 — 부모가 자리를 쥔 채 자식을 기다리다 서로 막히지 않게
 *
 * 자원 잠금(2026-10-18): 플로우 설정 locks의 이름마다 서버 전체에서 한 번에 한 실행만. 자리(동시 한도)보다 **먼저** 잡는다 —
 *   자원을 기다리는 동안 서버의 자리를 쥐고 있지 않게. 부른 실행은 부모가 잡은 자원을 함께 쓴다(같은 이름을 다시 기다리다 서로 막히지 않게).
 *   이름 차례대로 잡는다(두 실행이 서로의 자원을 기다리지 않게).
 *
 * 승인 기다리기(2026-10-18): 엔진이 묻는다(approval) → 여기 «기다리는 승인»에 두고 · 지켜보는 화면에 이벤트 · 알림.
 *   POST /api/runs/:id/approval이 답한다(역할이 노드의 minRole 이상). 실행이 끝나면(멈춤 · 시간 넘김) 걷는다.
 *
 * 워커(2026-10-17, PLAN §26): 어디서 도나 — 요청의 on(이번만) · 없으면 플로우 설정(flow.run_on) · 없으면 서버.
 *   서버의 동시 한도는 **서버에서 도는 실행만** 센다 — 워커는 워커마다 자리가 따로 있다(run/worker-hub.ts)
 */
import { randomUUID } from "node:crypto";
import { planResume, ResumeError, withParamDefaults, type Flow, type Output, type ResumePlan, type ResumeSource } from "@flowsmith/core";
import { checkRunInputs, PII_MASK, type ApprovalAnswer, type AskApproval, type CallFlow, type RunEvent, type RunResult } from "@flowsmith/engine";
import { ROLE_LABEL } from "@flowsmith/core";
import type { Secrets } from "../storage/secrets.ts";
import { StoreError, type RunTrigger, type Store, type UserRole } from "../storage/store.ts";
import type { WorkerClient } from "./worker.ts";
import type { RunScreens } from "../live/run-screens.ts";
import type { Notifier } from "./notifier.ts";
import { reaches } from "../rules/teams.ts";

/** 지켜보는 쪽에 가는 것 — 엔진 이벤트 + 끝 */
export type Watch = RunEvent
  | { kind: "run:end"; status: "success" | "failure" | "cancelled" | "blocked"; message: string }
  /** 동시 실행 한도에 걸려 차례를 기다린다 — 앞에 몇 개 */
  | { kind: "run:queued"; ahead: number }
  /** 워커에 갔다 — 그 워커 이름 */
  | { kind: "run:placed"; worker: string }
  /** 자원 잠금 — 이 자원을 다른 실행(그 플로우 이름)이 쓰고 있어 기다린다 */
  | { kind: "run:locked"; lock: string; holder: string };

interface Live {
  flowId: string;
  events: Watch[];
  listeners: Set<(e: Watch) => void>;
  done: Promise<void>;
}

export interface StartRequest {
  /** 버전 번호 · "draft"(초안 시험 실행) · 없으면 배포된 버전 */
  version?: number | "draft";
  params?: Record<string, string>;
  trigger?: RunTrigger;
  /** 다른 플로우가 불렀으면 — 부른 실행 · 부른 줄(순환을 막는다) */
  parentRunId?: string;
  chain?: string[];
  /** 일부만 돌린다(초안만) — 이 노드 앞에서 · 이 노드까지 */
  stopBefore?: string;
  stopAfter?: string;
  /** 지갑 브라우저 — 그 지갑의 프로필을 지우고 처음부터 준비한 뒤 돈다(«지갑 다시 준비») */
  resetWallet?: boolean;
  /** 손으로 · API로 돌린 사람(메일) — 기록에 남긴다 */
  startedBy?: string | null;
  /** 이번만 어디서 — 「server」 · 「worker:<id>」 · 「label:<라벨>」. 없으면 플로우 설정대로 */
  on?: string | null;
  /** 부른 실행 — 부모 줄이 이미 잡은 자원(다시 잡지 않는다) */
  heldLocks?: string[];
  /**
   * 여기서부터 다시 — 그 실행의 그 단계부터(core planResume). 앞 단계는 그 실행의 출력을 고정된 출력으로 쓴다.
   * 버전 · 입력은 부르는 쪽이 그 실행 것으로 준다
   */
  resume?: { runId: string; nodeId: string };
}

/** 승인을 기다리는 실행 — 화면 · 승인 목록이 본다 */
export interface PendingApproval {
  runId: string;
  flowId: string;
  flowName: string;
  version: number | null;
  nodeId: string;
  nodeName: string;
  message: string;
  minRole: "runner" | "editor" | "admin";
  deadline: string;
  since: string;
}
const RANK: Record<UserRole, number> = { viewer: 0, runner: 1, editor: 2, admin: 3 };

/** 다른 플로우가 다른 플로우를 부르는 깊이 — 이보다 깊으면 멈춘다 */
const MAX_CALL_DEPTH = 5;

/**
 * 팀이 닿는가 — 부르는 플로우가 다른 플로우를 부르거나 그 파일을 읽어도 되나.
 * ★대상은 공용이거나 같은 팀이어야 한다(공용 플로우는 공용만) — 남의 팀 파일 · 시크릿이 새지 않게
 */
export function sameTeamOrShared(store: Store, from: string, to: string): boolean {
  return reaches(store.flowTeam(from), store.flowTeam(to));
}

/** 파일 읽기가 읽을 «다른 플로우의 폴더»들 — 플로우 id → uid(없는 플로우 · 닿지 않는 팀은 빠진다 · 엔진이 «찾지 못함»으로 멈춘다) */
export function flowUidsFor(store: Store, flow: Flow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of flow.nodes) {
    if (n.type !== "fileRead" || n.config.source.scope !== "otherFlow" || !n.config.source.flowId) continue;
    if (!sameTeamOrShared(store, flow.id, n.config.source.flowId)) continue;
    try { out[n.config.source.flowId] = store.flowUid(n.config.source.flowId); } catch { /* 없는 플로우 */ }
  }
  return out;
}

export class Runs {
  readonly #live = new Map<string, Live>();
  /** 아직 끝나지 않은 실행들 */
  readonly #running = new Set<string>();
  /** 실행마다 멈추기 신호 · 부른 실행들 */
  readonly #abort = new Map<string, AbortController>();
  readonly #children = new Map<string, Set<string>>();
  /** 동시 실행 한도 — 자리 · 기다리는 줄 */
  readonly #maxConcurrent: number;
  #active = 0;
  readonly #waiting: { runId: string; go: () => void }[] = [];
  /** 자원 잠금 — 이름 → 쥔 실행 · 그 플로우 이름 · 기다리는 줄 */
  readonly #locks = new Map<string, { holder: string; flowName: string; waiters: { runId: string; flowName: string; go: () => void }[] }>();
  /** 승인 기다리기 — 실행 id → 기다리는 승인(실행마다 하나 — 노드는 차례로 돈다) */
  readonly #approvals = new Map<string, PendingApproval & { answer: (a: ApprovalAnswer) => void }>();
  /** 실행이 끝났다 — 다른 플로우가 끝나면 실행(run/chain.ts Chainer)이 받는다 */
  onFinished: ((f: { flowId: string; runId: string; version: number | null; status: "success" | "failure" | "cancelled" | "blocked"; output: Record<string, unknown>; chain: string[]; parentRunId: string | null }) => void) | null = null;
  /** 실제 실행이 요소를 못 찾았을 때 — 서버가 확인 점검을 건다(app.ts) */
  onBreakage: ((flowId: string, version: number | null) => void) | null = null;
  /** 실행 화면 보기 — 있으면 실행마다 «지금 페이지»를 알려 준다(보는 사람이 있을 때만 화면을 보낸다) */
  screens: RunScreens | null = null;
  /** 알림 — 끝난 실행을 플로우 설정의 규칙대로 알린다(게시된 버전 · 부른 실행 아님만) */
  notifier: Notifier | null = null;
  private readonly store: Store;
  private readonly secrets: Secrets;
  private readonly worker: WorkerClient;

  constructor(store: Store, secrets: Secrets, worker: WorkerClient, opts: { maxConcurrent?: number } = {}) {
    this.store = store;
    this.secrets = secrets;
    this.worker = worker;
    this.#maxConcurrent = Math.max(1, opts.maxConcurrent ?? 3);
  }

  /** 자리를 얻는다 — 없으면 줄을 서고, 기다리는 동안 앞에 몇 개인지 알린다. 멈추면 false */
  async #acquire(runId: string, signal: AbortSignal, push: (e: Watch) => void): Promise<boolean> {
    if (this.#active < this.#maxConcurrent && this.#waiting.length === 0) { this.#active++; return true; }
    push({ kind: "run:queued", ahead: this.#waiting.length });
    return new Promise<boolean>((resolve) => {
      const entry = { runId, go: () => { signal.removeEventListener("abort", onAbort); this.#active++; resolve(true); } };
      const onAbort = () => { const i = this.#waiting.indexOf(entry); if (i >= 0) this.#waiting.splice(i, 1); resolve(false); };
      signal.addEventListener("abort", onAbort, { once: true });
      this.#waiting.push(entry);
    });
  }

  /** 자원들을 이름 차례대로 잡는다 — 기다리게 되면 누가 쓰는지 알린다. 멈추면 잡은 것을 놓고 false */
  async #lockAll(runId: string, flowName: string, names: readonly string[], signal: AbortSignal, push: (e: Watch) => void): Promise<boolean> {
    const got: string[] = [];
    for (const name of [...names].sort()) {
      const cur = this.#locks.get(name);
      if (!cur) { this.#locks.set(name, { holder: runId, flowName, waiters: [] }); got.push(name); continue; }
      push({ kind: "run:locked", lock: name, holder: cur.flowName });
      const ok = await new Promise<boolean>((resolve) => {
        const me = { runId, flowName, go: () => { signal.removeEventListener("abort", onAbort); resolve(true); } };
        const onAbort = () => { const i = cur.waiters.indexOf(me); if (i >= 0) cur.waiters.splice(i, 1); resolve(false); };
        signal.addEventListener("abort", onAbort, { once: true });
        cur.waiters.push(me);
      });
      if (!ok) { this.#unlockAll(runId, got); return false; }
      got.push(name);
    }
    return true;
  }

  /** 잡은 자원을 놓는다 — 기다리던 다음 실행에게 넘긴다 */
  #unlockAll(runId: string, names: readonly string[]): void {
    for (const name of names) {
      const cur = this.#locks.get(name);
      if (!cur || cur.holder !== runId) continue;
      const next = cur.waiters.shift();
      if (!next) { this.#locks.delete(name); continue; }
      cur.holder = next.runId;
      cur.flowName = next.flowName;
      next.go();
    }
  }

  /** 지금 잡힌 자원 — 이름 → 쥔 실행 · 기다리는 수(시험 · 화면) */
  lockState(): Record<string, { holder: string; flowName: string; waiting: number }> {
    return Object.fromEntries([...this.#locks].map(([k, v]) => [k, { holder: v.holder, flowName: v.flowName, waiting: v.waiters.length }]));
  }

  #release(): void {
    this.#active--;
    const next = this.#waiting.shift();
    if (next) next.go();
  }

  /**
   * 멈추기 — 돌고 있으면 true. 그 실행이 부른 실행(다른 플로우 실행)도 함께 멈춘다.
   * ☆확장 노드처럼 엔진이 깨울 수 없는 일은 그 일이 끝난 뒤 멈춘다
   */
  cancel(runId: string): boolean {
    const c = this.#abort.get(runId);
    if (!c || !this.#running.has(runId)) return false;
    c.abort();
    for (const child of this.#children.get(runId) ?? []) this.cancel(child);
    return true;
  }

  #flowFor(flowId: string, version: StartRequest["version"]): { flow: Flow; version: number | null } {
    if (version === "draft") return { flow: this.store.getDraftFlow(flowId), version: null };
    const v = version ?? this.store.activeVersion(flowId);
    if (v === null) throw new StoreError(409, `워크플로우 "${flowId}"에 배포된 버전이 없습니다 — 버전을 만들고 배포하거나, 초안으로 시험 실행하세요`);
    return { flow: this.store.getVersion(flowId, v), version: v };
  }

  /** 여기서부터 다시의 계획 — 같은 워크플로우의 끝난 실행이어야 */
  #resumePlan(flowId: string, flow: Flow, r: { runId: string; nodeId: string }): ResumePlan {
    const src = this.store.getRun(r.runId);
    if (src.flowId !== flowId) throw new StoreError(400, "다른 워크플로우의 실행입니다");
    if (src.status === "running") throw new StoreError(409, "아직 도는 실행입니다 — 끝난 뒤에 그 단계부터 다시 할 수 있습니다");
    const nodes = ((src.result as { nodes?: ResumeSource[] } | null)?.nodes ?? []);
    const masked = (o: Output) => JSON.stringify(o).includes(PII_MASK);
    try { return planResume(flow, nodes, r.nodeId, masked); }
    catch (e) { if (e instanceof ResumeError) throw new StoreError(409, e.message); throw e; }
  }

  /** 여기서부터 다시 — 미리 보기(화면이 누르기 전에): 지난 출력을 쓰는 단계 · 다시 도는 앞 단계. 할 수 없으면 까닭 */
  previewResume(runId: string, nodeId: string): { from: string; reused: string[]; again: ResumePlan["again"] } | { error: string } {
    const src = this.store.getRun(runId);
    try {
      const plan = this.#resumePlan(src.flowId, this.#flowFor(src.flowId, src.version ?? "draft").flow, { runId, nodeId });
      return { from: plan.from, reused: Object.keys(plan.pins), again: plan.again };
    } catch (e) {
      if (e instanceof StoreError) return { error: e.message };
      throw e;
    }
  }

  start(flowId: string, req: StartRequest = {}): string {
    const found = this.#flowFor(flowId, req.version);
    const version = found.version;
    // 팀 공용 변수 — 제 팀 → 공용 차례로 찾아 vars에 더한다(storage/secrets.ts)
    const { flow, missing } = this.secrets.withShared(flowId, found.flow);
    const part = req.stopBefore ?? req.stopAfter;
    if (part !== undefined) {
      if (version !== null) throw new StoreError(400, "일부만 돌리기는 초안에서만 합니다");
      if (!flow.nodes.some((n) => n.id === part)) throw new StoreError(400, `노드 "${part}"가 없습니다`);
    }
    // 비어 있는 입력은 기본값으로 — 실행 기록에도 실제로 쓴 값이 남는다(같은 입력으로 다시 실행)
    const params = withParamDefaults(flow.params, Object.fromEntries(Object.entries(req.params ?? {}).map(([k, v]) => [k, String(v)])));
    const secrets = this.secrets.unlockFor(flowId, flow.secrets);
    const problems = [...checkRunInputs(flow, params, secrets), ...missing.map((n) => `팀 공용 변수 '${n}'가 없습니다 — 관리자가 팀 화면에서 넣습니다`)];
    if (problems.length > 0) throw new StoreError(400, "실행할 수 없습니다", problems);
    // 이번만 어디서 — 개인 워커(내 PC)는 그 주인이 돌린 실행만(storage/workers.ts)
    const on = req.on !== undefined ? this.store.checkRunOn(flowId, req.on, { by: req.startedBy ?? null }) : this.store.flowRunOn(flowId);

    // 여기서부터 다시 — 계획이 서지 않으면(앞 단계가 끝나지 않음 · 단계가 없어짐) 시작하지 않는다
    const resumed = req.resume ? this.#resumePlan(flowId, flow, req.resume) : null;

    const runId = randomUUID();
    this.store.insertRun({ id: runId, flowId, version, trigger: req.trigger ?? "manual", params, parentRunId: req.parentRunId ?? null, startedBy: req.startedBy ?? null,
      resumedFrom: resumed ? { runId: req.resume!.runId, nodeId: resumed.from, nodeName: flow.nodes.find((n) => n.id === resumed.from)!.name } : null });
    const abort = new AbortController();
    this.#abort.set(runId, abort);
    if (req.parentRunId) {
      const kids = this.#children.get(req.parentRunId) ?? new Set<string>();
      kids.add(runId);
      this.#children.set(req.parentRunId, kids);
    }
    const live: Live = { flowId, events: [], listeners: new Set(), done: Promise.resolve() };
    this.#running.add(runId);
    const push = (e: Watch) => {
      live.events.push(e);
      for (const l of live.listeners) l(e);
      // 사람 기다리기 — 실행 화면이 이 동안만 입력을 받고, 보는 사람이 없을 수 있으니(일정 · 웹훅) 알린다
      if (e.kind === "approval" && e.state === "waiting") {
        try {
          this.notifier?.approvalWaiting({ flow, version, runId, trigger: req.trigger ?? "manual", message: e.message, minRole: e.minRole, nodeName: flow.nodes.find((n) => n.id === e.nodeId)?.name ?? e.nodeId, deadline: e.deadline ?? new Date().toISOString() });
        } catch (err) { console.error("알림을 보내지 못했습니다:", err); }
      }
      if (e.kind === "human") {
        this.screens?.human(runId, e.state === "waiting" ? { prompt: e.prompt, deadline: e.deadline } : null);
        if (e.state === "waiting") {
          try {
            this.notifier?.humanWaiting({ flow, version, runId, trigger: req.trigger ?? "manual", prompt: e.prompt, nodeName: flow.nodes.find((n) => n.id === e.nodeId)?.name ?? e.nodeId, deadline: e.deadline ?? new Date().toISOString() });
          } catch (err) { console.error("알림을 보내지 못했습니다:", err); }
        }
      }
    };
    this.#live.set(runId, live);

    const t0 = Date.now();
    const chain = [...(req.chain ?? []), flowId];
    // 자원 잠금 — 부모 줄이 이미 잡은 것은 함께 쓴다 · 부르는 실행에게는 이 실행이 잡을 것까지 넘긴다
    const inherited = req.heldLocks ?? [];
    const mine = flow.settings.locks.filter((l) => !inherited.includes(l));
    const held = [...inherited, ...mine];
    // 다른 플로우 실행 — 그 플로우를 이 서버의 실행으로 돌리고(기록이 따로 남는다) 끝날 때까지 기다린다
    const callFlow: CallFlow = async (c) => {
      const fail = (message: string) => ({ runId: null, status: "failure" as const, message, output: {} });
      if (chain.includes(c.flowId)) return fail(`순환 — ${[...chain, c.flowId].join(" → ")}. 워크플로우가 자기를 다시 부르게 되어 멈췄습니다`);
      if (chain.length >= MAX_CALL_DEPTH) return fail(`너무 깊게 부릅니다(${MAX_CALL_DEPTH}단까지) — ${chain.join(" → ")}`);
      if (!sameTeamOrShared(this.store, flowId, c.flowId)) return fail(`워크플로우 "${c.flowId}"가 없습니다(다른 팀의 워크플로우는 부를 수 없습니다 — 공용이거나 같은 팀이어야 합니다)`);
      let childId: string;
      try {
        childId = this.start(c.flowId, { ...(c.version === "draft" ? { version: "draft" as const } : {}), params: c.params, trigger: "flow", parentRunId: runId, chain, heldLocks: held });
      } catch (e) {
        return fail(e instanceof StoreError ? [e.message, ...e.problems].join(" · ") : e instanceof Error ? e.message : String(e));
      }
      await this.wait(childId);
      const row = this.store.getRun(childId);
      const out = (row.result as { output?: Record<string, unknown> } | null)?.output ?? {};
      return { runId: childId, status: row.status === "success" ? "success" : "failure", message: row.status === "cancelled" ? `멈춤 — ${row.message}` : row.status === "blocked" ? `막힘 — ${row.message}` : row.message, output: out };
    };
    // 승인 기다리기 — 엔진이 묻는다. 답(answerApproval) · 그만둠(signal) · 실행 끝(finally) 중 먼저 오는 것
    const approval: AskApproval = (ask) => new Promise<ApprovalAnswer>((resolve, reject) => {
      const done = () => { if (this.#approvals.get(runId) === entry) this.#approvals.delete(runId); };
      const entry = {
        runId, flowId, flowName: flow.name, version, nodeId: ask.nodeId, nodeName: flow.nodes.find((n) => n.id === ask.nodeId)?.name ?? ask.nodeId,
        message: ask.message, minRole: ask.minRole, deadline: ask.deadline, since: new Date().toISOString(),
        answer: (a: ApprovalAnswer) => { done(); resolve(a); },
      };
      ask.signal.addEventListener("abort", () => { done(); reject(new Error("승인 기다리기를 그만두었습니다")); }, { once: true });
      this.#approvals.set(runId, entry);
    });
    const onPage = this.screens?.track(runId);
    const screen = this.screens?.sink(runId);
    // ★부른 실행(자식)은 부모의 자리를 함께 쓴다 — 줄을 서지 않는다
    const root = !req.parentRunId;
    const notify = (status: "success" | "failure" | "cancelled" | "blocked", message: string, result: RunResult | null, ms: number | null) => {
      try { this.notifier?.runFinished({ flow, version, runId, parentRunId: req.parentRunId ?? null, trigger: req.trigger ?? "manual", status, message, result, ms }); }
      catch (e) { console.error("알림을 보내지 못했습니다:", e); }
    };
    const execute = async () => {
      // ★서버의 자리는 서버에서 도는 실행만 — 워커로 가는 실행은 워커의 자리를 기다린다
      const slot = root && on === null;
      const stopWaiting = (message: string) => {
        // 기다리다 멈췄다 — 엔진은 돌지 않았다
        this.store.finishRun(runId, "cancelled", message, null, Date.now() - t0);
        this.screens?.end(runId, "cancelled", message);
        push({ kind: "run:end", status: "cancelled", message });
        notify("cancelled", message, null, Date.now() - t0);
        return null;
      };
      // 자원 먼저 — 자원을 기다리는 동안 서버의 자리를 쥐지 않게
      if (mine.length && !(await this.#lockAll(runId, flow.name, mine, abort.signal, push))) return stopWaiting("실행을 멈췄습니다(자원을 기다리던 중)");
      if (slot && !(await this.#acquire(runId, abort.signal, push))) { this.#unlockAll(runId, mine); return stopWaiting("실행을 멈췄습니다(차례를 기다리던 중)"); }
      try {
        // 고정된 출력 — 초안 시험에만(게시된 버전 · 일정 · 웹훅은 늘 진짜로 돈다). 초안에 없는 노드의 것은 버린다
        const pins = { ...(version === null ? Object.fromEntries(Object.entries(this.store.flowPins(flowId)).filter(([nid]) => flow.nodes.some((n) => n.id === nid))) : {}),
          // 여기서부터 다시 — 앞 단계는 그 실행의 출력(게시된 버전이어도)
          ...(resumed?.pins ?? {}) };
        return await this.worker.run({
          runId, flow, params, secrets, flowUid: this.store.flowUid(flowId), flowUids: flowUidsFor(this.store, flow), on, parentRunId: req.parentRunId ?? null,
          ...(Object.keys(pins).length ? { pins } : {}),
          ...(req.stopBefore ? { stopBefore: req.stopBefore } : {}), ...(req.stopAfter ? { stopAfter: req.stopAfter } : {}),
          ...(req.resetWallet ? { resetWallet: true } : {}),
        }, push, {
          callFlow, approval, signal: abort.signal, ...(onPage ? { onPage } : {}), ...(screen ? { screen } : {}),
          onQueued: (ahead) => push({ kind: "run:queued", ahead }),
          onPlaced: (w) => {
            if (!w) return;
            this.store.setRanOn(runId, w.name);
            // 워커로 갔다 — 화면은 그 PC가 보내 준다(중계 · 옛 워커면 «화면 보기는 서버에서 도는 실행만»)
            if (w.screen) this.screens?.remote(runId, w.name, w.screen); else this.screens?.elsewhere(runId, w.name);
            push({ kind: "run:placed", worker: w.name });
          },
        });
      } finally {
        if (slot) this.#release();
        this.#unlockAll(runId, mine);
      }
    };
    live.done = execute().then(
      (full) => {
        if (full === null) return;
        // 검사 불통과 스크린샷 — 실행 기록 본문에는 두지 않고 따로(크다 · 목록을 무겁게 하지 않게)
        const { shot, ...result } = full;
        if (shot) { try { this.store.putRunShot(runId, { nodeId: shot.nodeId, mime: shot.mime, data: Buffer.from(shot.data, "base64") }); } catch (e) { console.error("스크린샷을 두지 못했습니다:", e); } }
        this.store.finishRun(runId, result.status, result.message, result, result.ms);
        this.screens?.end(runId, result.status, result.message);
        // ★실제 실행이 «요소 없음 · 여러 개»로 멈췄으면 **확인 점검**을 돌린다(바로 «사이트가 바뀜»으로 적지 않는다).
        //  없는 주문번호를 넣어도 결과 칸이 «없음»이다 — 그건 입력 탓이지 사이트 탓이 아니다.
        //  점검용 입력값(검증된 값)으로도 깨지면 그때 알린다.
        if (result.nodes.some((n) => n.failure && (n.failure.problem === "missing" || n.failure.problem === "many"))) this.onBreakage?.(flowId, version);
        push({ kind: "run:end", status: result.status, message: result.message });
        notify(result.status, result.message, result, result.ms);
        try { this.onFinished?.({ flowId, runId, version, status: result.status, output: result.output, chain: req.chain ?? [], parentRunId: req.parentRunId ?? null }); }
        catch (e) { console.error("뒤 워크플로우를 깨우지 못했습니다:", e); }
      },
      (e: unknown) => {
        // 엔진은 노드 실패를 결과로 돌려준다 — 여기 오는 건 브라우저가 못 뜨는 등 바깥 사고다
        const message = `실행기 오류: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
        this.store.finishRun(runId, "failure", message, null, Date.now() - t0);
        this.screens?.end(runId, "failure", message);
        push({ kind: "run:end", status: "failure", message });
        notify("failure", message, null, Date.now() - t0);
        try { this.onFinished?.({ flowId, runId, version, status: "failure", output: {}, chain: req.chain ?? [], parentRunId: req.parentRunId ?? null }); }
        catch (err) { console.error("뒤 워크플로우를 깨우지 못했습니다:", err); }
      },
    ).finally(() => {
      this.#running.delete(runId);
      this.#abort.delete(runId);
      this.#approvals.delete(runId);
      this.#children.delete(runId);
      if (req.parentRunId) this.#children.get(req.parentRunId)?.delete(runId);
      // 끝난 뒤 잠깐은 다시 붙어도 처음부터 볼 수 있게 남겨 둔다
      setTimeout(() => this.#live.delete(runId), 60_000).unref();
    });
    return runId;
  }

  /** 기다리는 승인 — 실행 하나 · 전부(보이는 것만 거르는 건 길이 한다) */
  approvalOf(runId: string): PendingApproval | null {
    const a = this.#approvals.get(runId);
    if (!a) return null;
    const { answer: _answer, ...rest } = a;
    return rest;
  }
  pendingApprovals(): PendingApproval[] {
    return [...this.#approvals.keys()].map((id) => this.approvalOf(id)!).sort((a, b) => a.since.localeCompare(b.since));
  }

  /**
   * 승인 · 거절 — role이 null이면 로그인을 끈 서버(혼자 쓴다 — 누구든).
   * ★노드가 정한 역할(minRole) 이상만 — 실행자가 돌린 실행을 편집자가 승인하게 할 수 있다
   */
  answerApproval(runId: string, a: { approved: boolean; comment: string; by: string | null; role: UserRole | null }): void {
    const p = this.#approvals.get(runId);
    if (!p) throw new StoreError(409, "승인을 기다리는 실행이 아닙니다 — 이미 답했거나 끝났습니다");
    if (a.role !== null && RANK[a.role] < RANK[p.minRole]) throw new StoreError(403, `${ROLE_LABEL[p.minRole]} 이상만 승인 · 거절할 수 있습니다(지금: ${ROLE_LABEL[a.role]})`);
    p.answer({ approved: a.approved, by: a.by, comment: a.comment.trim().slice(0, 500) });
  }

  /** 이 플로우의 실행이 아직 돌고 있나 — 일정이 겹치지 않게 */
  isRunning(flowId: string): boolean {
    for (const id of this.#running) if (this.#live.get(id)?.flowId === flowId) return true;
    return false;
  }

  /** 시작도 못 한 실행을 기록한다 — 일정이 조용히 안 돌면 아무도 모른다 */
  recordRejected(flowId: string, version: number | null, trigger: RunTrigger, params: Record<string, string>, message: string): string {
    const runId = randomUUID();
    this.store.insertRun({ id: runId, flowId, version, trigger, params });
    this.store.finishRun(runId, "failure", message, null, 0);
    // ★시작도 못 한 일정 — 알린다(게시된 버전을 읽을 수 있을 때만. 못 읽으면 알림 설정도 모른다)
    if (version !== null) {
      try { this.notifier?.runFinished({ flow: this.store.getVersion(flowId, version), version, runId, parentRunId: null, trigger, status: "failure", message, result: null, ms: 0 }); }
      catch { /* 버전을 읽지 못했다 */ }
    }
    return runId;
  }

  /**
   * 진행을 받는다. 이미 지난 것부터 다시 보내고 이어서 흘려 준다.
   * 끝났고 기억에서도 지워졌으면 null — 저장소에서 결과를 읽으면 된다.
   */
  subscribe(runId: string, fn: (e: Watch) => void): (() => void) | null {
    const live = this.#live.get(runId);
    if (!live) return null;
    for (const e of live.events) fn(e);
    live.listeners.add(fn);
    return () => live.listeners.delete(fn);
  }

  /** 서버에서 지금 도는 실행 수 · 한도 — 워커 화면의 «서버» 줄 */
  localLoad(): { active: number; max: number; waiting: number } { return { active: this.#active, max: this.#maxConcurrent, waiting: this.#waiting.length }; }

  /** 끝날 때까지 기다린다 — 다른 플로우 실행(callFlow)이 자식을 기다리고, 시험도 쓴다 */
  async wait(runId: string): Promise<void> {
    await this.#live.get(runId)?.done;
  }

  async drain(): Promise<void> {
    await Promise.all([...this.#live.values()].map((l) => l.done));
  }
}
