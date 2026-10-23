/**
 * **실행 · 점검 · 알림 · 트리거 기록과 정리 — run · probe · notice · webhook · schedule_fire** — Store(store.ts)가 겉모양이고, 이 저장소가 몸이다.
 * ★도는 실행 · 점검은 정리하지 않는다 · 서버가 다시 뜨면 «돌고 있음»으로 남은 것을 끊김으로 적는다.
 * 다른 표의 일은 `#store`를 거쳐 부른다(그 저장소가 맡는다).
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { now, tx, type Row } from "./db.ts";
import { nodeSummary, toRun, toProbe } from "./rows.ts";
import { StoreError, type ProbeRow, type NoticeRow, type RunRow, type RunTrigger, type StatNode, type StatRun } from "./types.ts";
import type { Store } from "./store.ts";

export class HistoryRepo {
  readonly #db: DatabaseSync;
  readonly #store: Store;

  constructor(db: DatabaseSync, store: Store) {
    this.#db = db;
    this.#store = store;
  }

  /** startedAt — 보통은 지금. 옮겨 온 기록 · 시험만 따로 준다 */
  insertRun(r: { id: string; flowId: string; version: number | null; trigger: RunTrigger; params: Record<string, string>; parentRunId?: string | null; startedAt?: string; startedBy?: string | null }): void {
    this.#db.prepare("INSERT INTO run (id, flow_id, version, trigger, status, params_json, started_at, parent_run_id, started_by) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)")
      .run(r.id, r.flowId, r.version, r.trigger, JSON.stringify(r.params), r.startedAt ?? now(), r.parentRunId ?? null, r.startedBy ?? null);
  }

  finishRun(id: string, status: "success" | "failure" | "cancelled" | "blocked", message: string, result: unknown, ms: number): void {
    const nodes = result === null ? null : JSON.stringify(nodeSummary(result));
    this.#db.prepare("UPDATE run SET status = ?, message = ?, result_json = ?, ms = ?, nodes_json = ? WHERE id = ?")
      .run(status, message, result === null ? null : JSON.stringify(result), ms, nodes, id);
  }

  /** 어디서 돌았나 — 워커가 정해지면(라벨이면 그때 고른다) */
  setRanOn(id: string, worker: string | null): void {
    this.#db.prepare("UPDATE run SET ran_on = ? WHERE id = ?").run(worker, id);
  }

  getRun(id: string): RunRow {
    const r = this.#db.prepare("SELECT * FROM run WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new StoreError(404, `실행 "${id}"가 없습니다`);
    return toRun(r);
  }

  /**
   * 대시보드 — 이 때부터의 실행 전부(플로우를 가리지 않는다 · 보이는 것은 부르는 쪽이 거른다).
   * 결과 본문은 무거우니 노드 요약(종류 · 결과 · 시간 · 실패 문장)만 남긴다
   */
  runsSince(since: string): StatRun[] {
    // ★노드 요약(nodes_json)만 읽는다 — 옛 기록(요약 없음)만 결과 본문에서 만든다
    return (this.#db.prepare(`SELECT id, flow_id, status, trigger, started_at, ms, ran_on, parent_run_id, message, version, started_by, nodes_json,
      CASE WHEN nodes_json IS NULL THEN result_json END AS result_json FROM run WHERE started_at >= ? ORDER BY started_at`).all(since) as Row[]).map((r) => {
      let nodes: StatNode[] = [];
      try {
        if (r["nodes_json"]) nodes = JSON.parse(String(r["nodes_json"])) as StatNode[];
        else if (r["result_json"]) nodes = nodeSummary(JSON.parse(String(r["result_json"])));
      } catch { /* 깨진 기록 — 노드 없이 */ }
      return {
        id: String(r["id"]), flowId: String(r["flow_id"]), status: r["status"] as StatRun["status"], trigger: String(r["trigger"]), startedAt: String(r["started_at"]),
        ms: (r["ms"] as number | null) ?? null, ranOn: (r["ran_on"] as string | null) ?? null, parentRunId: (r["parent_run_id"] as string | null) ?? null,
        message: String(r["message"]), version: (r["version"] as number | null) ?? null, startedBy: (r["started_by"] as string | null) ?? null, nodes,
      };
    });
  }

  listRuns(flowId: string, limit = 50): RunRow[] {
    this.#store.flowRow(flowId);
    return (this.#db.prepare("SELECT * FROM run WHERE flow_id = ? ORDER BY started_at DESC LIMIT ?").all(flowId, limit) as Row[]).map(toRun);
  }

  /** 웹훅 토큰(해시)을 둔다 — 있으면 바꾼다(옛 토큰은 그 순간 무효) */
  setWebhook(flowId: string, tokenHash: string): string {
    this.#store.flowRow(flowId);
    const t = now();
    this.#db.prepare(`INSERT INTO webhook (flow_id, token_hash, created_at) VALUES (?, ?, ?)
      ON CONFLICT(flow_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at`).run(flowId, tokenHash, t);
    return t;
  }

  getWebhook(flowId: string): { tokenHash: string; createdAt: string } | null {
    const r = this.#db.prepare("SELECT token_hash, created_at FROM webhook WHERE flow_id = ?").get(flowId) as Row | undefined;
    return r ? { tokenHash: String(r["token_hash"]), createdAt: String(r["created_at"]) } : null;
  }

  deleteWebhook(flowId: string): boolean {
    return this.#db.prepare("DELETE FROM webhook WHERE flow_id = ?").run(flowId).changes > 0;
  }

  /** 이 일정의 이 분을 차지한다 — 이미 돌았으면 false */
  claimFire(flowId: string, scheduleId: string, minute: string): boolean {
    return this.#db.prepare("INSERT OR IGNORE INTO schedule_fire (flow_id, schedule_id, minute, at) VALUES (?, ?, ?, ?)").run(flowId, scheduleId, minute, now()).changes > 0;
  }

  insertProbe(p: { id: string; flowId: string; version: number | null; source: ProbeRow["source"]; status: ProbeRow["status"]; report: unknown }): void {
    this.#db.prepare("INSERT INTO probe (id, flow_id, version, source, status, at, report_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(p.id, p.flowId, p.version, p.source, p.status, now(), p.report === null ? null : JSON.stringify(p.report));
  }

  finishProbe(id: string, status: ProbeRow["status"], report: unknown): void {
    this.#db.prepare("UPDATE probe SET status = ?, report_json = ? WHERE id = ?").run(status, JSON.stringify(report), id);
  }

  getProbe(id: string): ProbeRow {
    const r = this.#db.prepare("SELECT * FROM probe WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new StoreError(404, `점검 "${id}"가 없습니다`);
    return toProbe(r);
  }

  latestProbe(flowId: string): ProbeRow | null {
    const r = this.#db.prepare("SELECT * FROM probe WHERE flow_id = ? AND status != 'running' ORDER BY at DESC LIMIT 1").get(flowId) as Row | undefined;
    return r ? toProbe(r) : null;
  }

  listProbes(flowId: string, limit = 20): ProbeRow[] {
    this.#store.flowRow(flowId);
    return (this.#db.prepare("SELECT * FROM probe WHERE flow_id = ? ORDER BY at DESC LIMIT ?").all(flowId, limit) as Row[]).map(toProbe);
  }

  /** 마지막 «점검 실행»이 언제였나 — 주기를 재는 기준(실제 실행이 발견한 것은 세지 않는다) */
  lastProbeAt(flowId: string): string | null {
    const r = this.#db.prepare("SELECT MAX(at) AS at FROM probe WHERE flow_id = ? AND source = 'probe'").get(flowId) as Row;
    return (r["at"] as string | null) ?? null;
  }

  /**
   * 이 실행 바로 앞의 «알릴 만한» 실행의 결과 — 게시된 버전 · 부른 실행 아님 · 성공 또는 실패(멈춤은 건너뛴다).
   * 실패가 이어지는지 · 회복했는지를 본다
   */
  previousRunStatus(flowId: string, runId: string): "success" | "failure" | null {
    const r = this.#db.prepare(`SELECT status FROM run WHERE flow_id = ? AND id != ? AND version IS NOT NULL AND parent_run_id IS NULL
      AND status IN ('success', 'failure') AND started_at <= (SELECT started_at FROM run WHERE id = ?) ORDER BY started_at DESC LIMIT 1`).get(flowId, runId, runId) as Row | undefined;
    return r ? (r["status"] as "success" | "failure") : null;
  }

  /** 이 점검 바로 앞의 끝난 점검(게시된 버전 · 오류 아님)의 결과 */
  previousProbeStatus(flowId: string, probeId: string): ProbeRow["status"] | null {
    const r = this.#db.prepare(`SELECT status FROM probe WHERE flow_id = ? AND id != ? AND version IS NOT NULL AND status IN ('ok', 'changed', 'broken')
      AND at <= (SELECT at FROM probe WHERE id = ?) ORDER BY at DESC LIMIT 1`).get(flowId, probeId, probeId) as Row | undefined;
    return r ? (r["status"] as ProbeRow["status"]) : null;
  }

  insertNotice(n: Omit<NoticeRow, "id" | "at">): NoticeRow {
    const row: NoticeRow = { ...n, id: randomUUID(), at: now() };
    this.#db.prepare("INSERT INTO notice (id, flow_id, rule_id, event, channel, ref_id, ok, status, error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(row.id, row.flowId, row.ruleId, row.event, row.channel, row.refId, row.ok ? 1 : 0, row.status, row.error, row.at);
    return row;
  }

  listNotices(flowId: string, limit = 30): NoticeRow[] {
    this.#store.flowRow(flowId);
    return (this.#db.prepare("SELECT * FROM notice WHERE flow_id = ? ORDER BY at DESC LIMIT ?").all(flowId, limit) as Row[]).map((r) => ({
      id: String(r["id"]), flowId: String(r["flow_id"]), ruleId: String(r["rule_id"]), event: String(r["event"]), channel: String(r["channel"]),
      refId: (r["ref_id"] as string | null) ?? null, ok: Number(r["ok"]) === 1, status: (r["status"] as number | null) ?? null, error: String(r["error"]), at: String(r["at"]),
    }));
  }

  /** 실행 기록 지우기 — 플로우마다 최근 keep개만 · before보다 오래된 것. ★도는 실행은 두고. 지운 수 */
  pruneRuns(keepPerFlow: number | null, before: string | null): number {
    let n = 0;
    if (before !== null) n += Number(this.#db.prepare("DELETE FROM run WHERE status != 'running' AND started_at < ?").run(before).changes);
    if (keepPerFlow !== null) {
      n += Number(this.#db.prepare(`DELETE FROM run WHERE status != 'running' AND id IN (
        SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY flow_id ORDER BY started_at DESC) AS rn FROM run) WHERE rn > ?)`).run(keepPerFlow).changes);
    }
    return n;
  }

  /** 감시 기록 지우기 — 플로우마다 최근 keep개만 · before보다 오래된 것(도는 점검은 두고) */
  pruneProbes(keepPerFlow: number, before: string | null): number {
    let n = 0;
    if (before !== null) n += Number(this.#db.prepare("DELETE FROM probe WHERE status != 'running' AND at < ?").run(before).changes);
    n += Number(this.#db.prepare(`DELETE FROM probe WHERE status != 'running' AND id IN (
      SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY flow_id ORDER BY at DESC) AS rn FROM probe) WHERE rn > ?)`).run(keepPerFlow).changes);
    return n;
  }

  /** 보낸 알림 기록 — 플로우마다 최근 keep개만 · before보다 오래된 것 */
  pruneNotices(keepPerFlow: number, before: string | null): number {
    let n = 0;
    if (before !== null) n += Number(this.#db.prepare("DELETE FROM notice WHERE at < ?").run(before).changes);
    n += Number(this.#db.prepare(`DELETE FROM notice WHERE id IN (
      SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY flow_id ORDER BY at DESC) AS rn FROM notice) WHERE rn > ?)`).run(keepPerFlow).changes);
    return n;
  }

  /** 일정 발화 기록 — 오래된 것은 쓸모가 없다 */
  pruneScheduleFires(before: string): number {
    return Number(this.#db.prepare("DELETE FROM schedule_fire WHERE at < ?").run(before).changes);
  }

  /** 실행 · 점검 · 파일 폴더(uid)가 어느 플로우의 것인가 — 권한을 볼 때 */
  runFlowId(runId: string): string | null { return ((this.#db.prepare("SELECT flow_id FROM run WHERE id = ?").get(runId) as Row | undefined)?.["flow_id"] as string | undefined) ?? null; }

  probeFlowId(probeId: string): string | null { return ((this.#db.prepare("SELECT flow_id FROM probe WHERE id = ?").get(probeId) as Row | undefined)?.["flow_id"] as string | undefined) ?? null; }

  /** 서버가 다시 뜰 때 — 돌던 것은 끊겼다. ★«돌고 있음»으로 영영 남겨 두지 않는다 */
  markInterrupted(): number {
    this.#db.prepare("UPDATE probe SET status = 'error', report_json = '{\"message\":\"서버가 다시 시작돼 점검이 끊겼습니다\"}' WHERE status = 'running'").run();
    return Number(this.#db.prepare("UPDATE run SET status = 'failure', message = '서버가 다시 시작돼 실행이 끊겼습니다' WHERE status = 'running'").run().changes);
  }

  // ─── 파일이 생기면(run/chain.ts FileWatcher) ─────────────────────────

  fileTriggerSignature(flowId: string, triggerId: string): string | null {
    const r = this.#db.prepare("SELECT signature FROM file_trigger WHERE flow_id = ? AND trigger_id = ?").get(flowId, triggerId) as Row | undefined;
    return r ? String(r["signature"]) : null;
  }

  /** 처음 · 폴더나 꼴이 바뀌었을 때 — 지금 있는 파일은 «본 것»으로(켜기 전 파일로는 돌지 않는다) */
  resetFileTrigger(flowId: string, triggerId: string, signature: string, names: readonly string[]): void {
    tx(this.#db, () => {
      this.#db.prepare("DELETE FROM file_seen WHERE flow_id = ? AND trigger_id = ?").run(flowId, triggerId);
      const ins = this.#db.prepare("INSERT OR IGNORE INTO file_seen (flow_id, trigger_id, name, at) VALUES (?, ?, ?, ?)");
      for (const n of names) ins.run(flowId, triggerId, n, now());
      this.#db.prepare("INSERT INTO file_trigger (flow_id, trigger_id, signature) VALUES (?, ?, ?) ON CONFLICT(flow_id, trigger_id) DO UPDATE SET signature = excluded.signature").run(flowId, triggerId, signature);
    });
  }

  seenFiles(flowId: string, triggerId: string): Set<string> {
    return new Set((this.#db.prepare("SELECT name FROM file_seen WHERE flow_id = ? AND trigger_id = ?").all(flowId, triggerId) as Row[]).map((r) => String(r["name"])));
  }

  markFileSeen(flowId: string, triggerId: string, name: string): void {
    this.#db.prepare("INSERT OR IGNORE INTO file_seen (flow_id, trigger_id, name, at) VALUES (?, ?, ?, ?)").run(flowId, triggerId, name, now());
  }

  // ─── 검사 불통과 스크린샷(한 실행에 한 장) ─────────────────────────

  putRunShot(runId: string, shot: { nodeId: string; mime: string; data: Buffer }): void {
    this.#db.prepare("INSERT INTO run_shot (run_id, node_id, mime, data, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET node_id = excluded.node_id, mime = excluded.mime, data = excluded.data, at = excluded.at")
      .run(runId, shot.nodeId, shot.mime, shot.data, now());
  }

  runShot(runId: string): { nodeId: string; mime: string; data: Uint8Array } | null {
    const r = this.#db.prepare("SELECT node_id, mime, data FROM run_shot WHERE run_id = ?").get(runId) as Row | undefined;
    return r ? { nodeId: String(r["node_id"]), mime: String(r["mime"]), data: r["data"] as Uint8Array } : null;
  }
}
