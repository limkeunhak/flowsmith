/**
 * **Suite 실행** — 시나리오(게시된 플로우)를 차례로 돌려 통과 · 불통과 · 오류를 판정한다(PLAN §39).
 *
 *   전체  켜 둔 시나리오를 순서대로 — ★하나가 실패해도 다음으로(테스트는 다 돌아야 무엇이 깨졌는지 안다)
 *   단건  시나리오 하나만
 *   판정  core verdictOf — 끝까지 돌면 통과 · 검사 노드가 틀리면 불통과 · 사이트 · 요소 · 시간이면 오류
 *   묶음  불통과가 하나라도 → fail · 아니고 오류가 하나라도 → error · 다 통과 → pass
 *   일정  Suite의 cron — 같은 분에 두 번 돌지 않는다 · 앞 실행이 돌고 있으면 건너뛴다
 *   알림  Suite의 규칙(불통과 · 회복 · 통과) — 요약 한 건(«12개 중 2개 불통과»)
 */
import { randomUUID } from "node:crypto";
import { cronMatches, minuteKey, parseCron, VERDICT_LABEL, verdictOf } from "@flowsmith/core";
import type { RunResult } from "@flowsmith/engine";
import { StoreError, type Store } from "../storage/store.ts";
import type { Suite, SuiteRun, SuiteRunItem, SuiteRunStatus } from "../storage/suites.ts";
import type { Runs } from "./runs.ts";
import type { Notifier } from "./notifier.ts";

const TICK_MS = 15_000;

export function suiteStatusOf(items: readonly SuiteRunItem[]): Exclude<SuiteRunStatus, "running" | "cancelled"> {
  if (items.some((i) => i.verdict === "fail")) return "fail";
  if (items.some((i) => i.verdict === "error")) return "error";
  return "pass";
}

export class SuiteRunner {
  readonly #store: Store;
  readonly #runs: Runs;
  readonly #notifier: Notifier;
  /** 도는 Suite 실행 — 멈추기 · 지금 도는 시나리오의 실행 */
  readonly #live = new Map<string, { suiteId: string; cancelled: boolean; current: string | null; done: Promise<void> }>();
  #timer: NodeJS.Timeout | null = null;

  constructor(store: Store, runs: Runs, notifier: Notifier) {
    this.#store = store;
    this.#runs = runs;
    this.#notifier = notifier;
    store.abandonSuiteRuns();
  }

  isRunning(suiteId: string): boolean {
    return [...this.#live.values()].some((l) => l.suiteId === suiteId);
  }

  /** 시작한다 — 실행 id가 바로 나가고 뒤에서 돈다. only면 그 시나리오 하나만 */
  start(suiteId: string, opts: { only?: string | null; trigger?: SuiteRun["trigger"]; by?: string | null } = {}): string {
    const suite = this.#store.getSuite(suiteId);
    if (this.isRunning(suiteId)) throw new StoreError(409, "이 Suite가 이미 돌고 있습니다 — 끝난 뒤에 다시 돌리세요");
    const targets = opts.only ? suite.items.filter((i) => i.id === opts.only) : suite.items.filter((i) => i.enabled);
    if (opts.only && targets.length === 0) throw new StoreError(404, "없는 시나리오입니다");
    if (targets.length === 0) throw new StoreError(400, "돌릴 시나리오가 없습니다 — 시나리오를 더하거나 켜세요");
    const names = new Map(this.#store.flowNames().map((f) => [f.id, f.name]));
    const items: SuiteRunItem[] = targets.map((t) => ({ itemId: t.id, flowId: t.flowId, label: t.label || names.get(t.flowId) || t.flowId, runId: null, verdict: "pending", message: "", ms: null, checks: { passed: 0, failed: 0 } }));
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    this.#store.insertSuiteRun({ id, suiteId, trigger: opts.trigger ?? "manual", only: opts.only ?? null, startedBy: opts.by ?? null, startedAt, items });
    const live = { suiteId, cancelled: false, current: null as string | null, done: Promise.resolve() };
    this.#live.set(id, live);
    live.done = this.#go(id, suite, targets, items, live, opts.by ?? null, Date.parse(startedAt))
      .catch((e: unknown) => console.error("Suite 실행 실패:", e))
      .finally(() => this.#live.delete(id));
    return id;
  }

  async #go(id: string, suite: Suite, targets: Suite["items"], items: SuiteRunItem[], live: { cancelled: boolean; current: string | null }, by: string | null, t0: number): Promise<void> {
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]!;
      const it = items[i]!;
      if (live.cancelled) { it.verdict = "skipped"; it.message = "Suite를 멈춰 돌지 않았습니다"; continue; }
      it.verdict = "running";
      this.#store.updateSuiteRun(id, items);
      const s0 = Date.now();
      try {
        // ★게시된 버전만(version 없음 = 게시된 것) — 게시하지 않았으면 오류
        const runId = this.#runs.start(t.flowId, { params: t.params, trigger: "suite", startedBy: by });
        it.runId = runId;
        live.current = runId;
        this.#store.updateSuiteRun(id, items);
        await this.#runs.wait(runId);
        const row = this.#store.getRun(runId);
        const result = row.result as RunResult | null;
        const failed = result?.nodes.find((n) => n.status === "failed");
        it.verdict = verdictOf(row.status, failed?.failure?.problem ?? null);
        it.message = it.verdict === "pass" ? (row.status === "blocked" ? `막힘 갈래로 끝남 — ${row.message}` : "") : row.message;
        const checks = (result?.nodes ?? []).flatMap((n) => n.checks ?? []);
        it.checks = { passed: checks.filter((c) => c.pass).length, failed: checks.filter((c) => !c.pass).length };
      } catch (e) {
        it.verdict = "error";
        it.message = e instanceof StoreError ? [e.message, ...e.problems].join(" · ") : e instanceof Error ? e.message : String(e);
      } finally {
        live.current = null;
        it.ms = Date.now() - s0;
      }
      this.#store.updateSuiteRun(id, items);
    }
    const status: SuiteRunStatus = live.cancelled ? "cancelled" : suiteStatusOf(items);
    this.#store.updateSuiteRun(id, items, { status, ms: Date.now() - t0 });
    if (status !== "cancelled") {
      try { this.#notify(suite, this.#store.getSuiteRun(id)); } catch (e) { console.error("Suite 알림을 보내지 못했습니다:", e); }
    }
  }

  #notify(suite: Suite, run: SuiteRun): void {
    const prev = run.only === null ? this.#store.previousSuiteStatus(suite.id, run.id) : null;
    const count = (v: string) => run.items.filter((i) => i.verdict === v).length;
    const ok = run.status === "pass";
    const failed = run.items.filter((i) => i.verdict === "fail" || i.verdict === "error");
    for (const rule of suite.notify) {
      if (!rule.enabled) continue;
      // 단건 실행은 회복으로 보지 않는다(묶음 전체의 상태가 아니다)
      const event = !ok ? (rule.on.includes("failure") ? "failure" : null)
        : prev !== null && prev !== "pass" && rule.on.includes("recovered") ? "recovered"
        : rule.on.includes("success") ? "success" : null;
      if (!event) continue;
      this.#notifier.suiteFinished(rule, {
        suite: { id: suite.id, name: suite.name }, runId: run.id, event,
        title: `${suite.name} — ${ok ? `통과 ${count("pass")}개` : `${run.items.length}개 중 ${failed.length}개 ${count("fail") ? "불통과" : "오류"}`}`,
        facts: [
          { name: "결과", value: `통과 ${count("pass")} · 불통과 ${count("fail")} · 오류 ${count("error")}${count("skipped") ? ` · 안 돎 ${count("skipped")}` : ""}` },
          ...failed.slice(0, 5).map((i) => ({ name: `${VERDICT_LABEL[i.verdict as "fail" | "error"]} — ${i.label}`, value: i.message.slice(0, 300) })),
          { name: "어떻게", value: `${run.trigger === "schedule" ? "일정" : run.trigger === "api" ? "API" : "손으로"}${run.only ? " · 단건" : ""}${run.ms !== null ? ` · ${Math.round(run.ms / 1000)}초` : ""}` },
        ],
      });
    }
  }

  /** 멈추기 — 지금 도는 시나리오를 멈추고 남은 것은 돌리지 않는다 */
  cancel(suiteRunId: string): boolean {
    const l = this.#live.get(suiteRunId);
    if (!l) return false;
    l.cancelled = true;
    if (l.current) this.#runs.cancel(l.current);
    return true;
  }

  async wait(suiteRunId: string): Promise<void> {
    await this.#live.get(suiteRunId)?.done;
  }

  startSchedule(tickMs = TICK_MS): void {
    this.#timer = setInterval(() => { try { this.tick(); } catch (e) { console.error("Suite 일정 확인 실패:", e); } }, tickMs);
    this.#timer.unref();
  }
  stop(): void { if (this.#timer) clearInterval(this.#timer); this.#timer = null; }

  /** 이 분에 돌 Suite 일정 — 시작한 Suite 실행 id들 */
  tick(now = new Date()): string[] {
    const minute = minuteKey(now);
    const started: string[] = [];
    for (const s of this.#store.listSuites()) {
      for (const sc of s.schedules) {
        if (!sc.enabled) continue;
        try { if (!cronMatches(parseCron(sc.cron), now)) continue; } catch { continue; }
        if (!this.#store.claimSuiteFire(s.id, sc.id, minute)) continue;
        if (this.isRunning(s.id)) { console.warn(`Suite «${s.name}» 일정 — 앞 실행이 돌고 있어 건너뜀`); continue; }
        try { started.push(this.start(s.id, { trigger: "schedule" })); } catch (e) { console.warn(`Suite «${s.name}» 일정 — 시작하지 못함: ${(e as Error).message}`); }
      }
    }
    return started;
  }
}
