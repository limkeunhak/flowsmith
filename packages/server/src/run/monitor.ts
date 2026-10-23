/**
 * **변경 감시** — 사이트가 바뀌어 플로우가 깨지기 전에 알아챈다 (PLAN §6).
 *
 *   주기 감시: 게시된 플로우마다 정한 주기(settings.monitorIntervalMin)로 점검 실행을 돌린다
 *   실행 중 발견: 실제 실행이 «요소 없음 · 여러 개»로 멈추면 **확인 점검**을 돌린다(source=run).
 *              ★바로 «바뀜»으로 적지 않는다 — 입력이 틀려도(없는 주문번호) 결과 칸은 «없음»이다
 *
 * ★점검은 되돌릴 수 없는 동작을 누르지 않는다(엔진의 probe). 점검용 입력값은 settings.probeParams.
 * ★사람의 크롬에 붙는 플로우(attach)는 **주기 감시에서 뺀다** — 사람이 쓰는 크롬을 주기적으로 움직이면 안 된다.
 *  «지금 점검»은 사람이 누르는 것이라 된다.
 * ☆한 번에 하나씩 돈다 — 감시 때문에 사이트를 두드리지 않는다.
 */
import { randomUUID } from "node:crypto";
import { checkRunInputs } from "@flowsmith/engine";
import type { Flow, ProbeReport } from "@flowsmith/core";
import type { Secrets } from "../storage/secrets.ts";
import type { Store } from "../storage/store.ts";
import type { WorkerClient } from "./worker.ts";
import { flowUidsFor } from "./runs.ts";
import type { Notifier } from "./notifier.ts";

const TICK_MS = 60_000;

export class Monitor {
  readonly #store: Store;
  readonly #secrets: Secrets;
  readonly #worker: WorkerClient;
  #timer: NodeJS.Timeout | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #pending = new Set<string>();
  /** 알림 — «사이트가 바뀜»을 플로우 설정의 규칙대로(게시된 버전만) */
  notifier: Notifier | null = null;

  constructor(store: Store, secrets: Secrets, worker: WorkerClient) {
    this.#store = store;
    this.#secrets = secrets;
    this.#worker = worker;
  }

  start(tickMs = TICK_MS): void {
    this.#timer = setInterval(() => void this.tick(), tickMs);
    this.#timer.unref();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#queue.catch(() => undefined);
  }

  /** 주기가 된 게시 플로우들을 줄 세운다 */
  async tick(now = Date.now()): Promise<string[]> {
    const started: string[] = [];
    for (const { id, version } of this.#store.activeFlows()) {
      let flow: Flow;
      try { flow = this.#store.getVersion(id, version); } catch { continue; }
      const every = flow.settings.monitorIntervalMin;
      if (every === null || flow.settings.browser === "attach" || this.#pending.has(id)) continue;
      const last = this.#store.lastProbeAt(id);
      if (last !== null && now - new Date(last).getTime() < every * 60_000) continue;
      started.push(this.probe(id, version));
    }
    return started;
  }

  /** 점검을 시작한다(뒤에서 돈다). 감시 기록 id를 돌려준다 */
  probe(flowId: string, version: number | "draft", source: "probe" | "run" = "probe"): string {
    const { flow, missing } = this.#secrets.withShared(flowId, version === "draft" ? this.#store.getDraftFlow(flowId) : this.#store.getVersion(flowId, version));
    const id = randomUUID();
    const v = version === "draft" ? null : version;
    this.#store.insertProbe({ id, flowId, version: v, source, status: "running", report: null });
    this.#pending.add(flowId);
    const job = this.#queue.then(async () => {
      const params = { ...flow.settings.probeParams };
      const secrets = this.#secrets.unlockFor(flowId, flow.secrets);
      const problems = [...checkRunInputs(flow, params, secrets), ...missing.map((n) => `팀 공용 변수 '${n}'가 없습니다`)];
      if (problems.length > 0) {
        this.#store.finishProbe(id, "error", errorReport(`점검을 시작할 수 없습니다 — ${problems.join(" · ")} (워크플로우 설정의 «점검용 입력값»을 채우세요)`));
        return;
      }
      const result = await this.#worker.run({ runId: id, flow, params, secrets, probe: true, flowUid: this.#store.flowUid(flowId), flowUids: flowUidsFor(this.#store, flow), on: this.#store.flowRunOn(flowId) }, () => undefined);
      const report = result.probe ?? errorReport(result.message || "점검 보고서가 없습니다");
      this.#store.finishProbe(id, report.status, report);
      try { this.notifier?.probeFinished({ flow, version: v, probeId: id, source, report }); } catch (e) { console.error("알림을 보내지 못했습니다:", e); }
    }).catch((e: unknown) => {
      this.#store.finishProbe(id, "error", errorReport(`점검이 돌지 못했습니다 — ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`));
    }).finally(() => this.#pending.delete(flowId));
    this.#queue = job;
    return id;
  }

  /** 시험용 — 줄 선 점검이 끝날 때까지 */
  async drain(): Promise<void> { await this.#queue.catch(() => undefined); }
}

const errorReport = (message: string): ProbeReport => ({ status: "error", stop: { nodeId: null, actionId: null, reason: message }, findings: [], checked: 0, message });

