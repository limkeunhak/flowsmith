/**
 * **워커(실행을 받아 가는 PC)와 «어디서 돌리나» — worker · flow.run_on** — Store(store.ts)가 겉모양이고, 이 저장소가 몸이다.
 * ★토큰은 해시만 · 팀 전용 워커는 그 팀 · 공용 플로우만(rules/teams.ts).
 * 다른 표의 일은 `#store`를 거쳐 부른다(그 저장소가 맡는다).
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { workerFits } from "../rules/teams.ts";
import { now, type Row } from "./db.ts";
import { newWorkerToken, workerTokenHash, workerName, labelsOf, slotsOf } from "./rows.ts";
import { StoreError, WORKER_KINDS, type WorkerInfo, type WorkerRow } from "./types.ts";
import type { Store } from "./store.ts";

export class WorkerRepo {
  readonly #db: DatabaseSync;
  readonly #store: Store;

  constructor(db: DatabaseSync, store: Store) {
    this.#db = db;
    this.#store = store;
  }

  /** 워커 · 팀 이름 · 이 워커에서 도는 플로우 수를 한 번에 — where는 하나만 찾을 때 */
  #workerRows(where = "", ...args: string[]): WorkerRow[] {
    return (this.#db.prepare(`SELECT w.*, t.name AS team_name, (SELECT COUNT(*) FROM flow f WHERE f.run_on = 'worker:' || w.id) AS flows
      FROM worker w LEFT JOIN team t ON t.id = w.team_id ${where} ORDER BY w.name`).all(...args) as Row[]).map((w) => ({
      id: String(w["id"]), name: String(w["name"]), labels: JSON.parse(String(w["labels_json"])) as string[], slots: Number(w["slots"]),
      team: w["team_id"] === null ? null : { id: String(w["team_id"]), name: (w["team_name"] as string | null) ?? "(없는 팀)" },
      enabled: Number(w["enabled"]) === 1, createdAt: String(w["created_at"]), lastSeenAt: (w["last_seen_at"] as string | null) ?? null,
      info: w["info_json"] ? JSON.parse(String(w["info_json"])) as WorkerInfo : null,
      flows: Number(w["flows"]),
      kind: w["kind"] === "personal" ? "personal" as const : "shared" as const,
      owner: (w["owner"] as string | null) ?? null,
    }));
  }

  listWorkers(): WorkerRow[] { return this.#workerRows(); }

  /** 없으면 null */
  findWorker(id: string): WorkerRow | null { return this.#workerRows("WHERE w.id = ?", id)[0] ?? null; }

  getWorker(id: string): WorkerRow {
    const w = this.findWorker(id);
    if (!w) throw new StoreError(404, "없는 워커입니다");
    return w;
  }

  /**
   * 새 워커 — 토큰은 이때 한 번만 돌려준다.
   * 개인 워커(personal) — 주인(있는 사람의 메일)이 있어야 한다 · 라벨 · 팀은 두지 않는다(주인이 돌린 실행만 받으니 고를 일이 없다)
   */
  createWorker(w: { name: string; labels?: unknown; slots?: unknown; team?: string | null; kind?: unknown; owner?: unknown }): { worker: WorkerRow; token: string } {
    const name = workerName(w.name);
    const kind = w.kind === undefined || w.kind === null || w.kind === "" ? "shared" : w.kind;
    if (!(WORKER_KINDS as readonly unknown[]).includes(kind)) throw new StoreError(400, `워커 종류는 shared(공용) · personal(개인)입니다 — ${String(kind)}`);
    const personal = kind === "personal";
    let owner: string | null = null;
    if (personal) {
      const u = typeof w.owner === "string" && w.owner.trim() ? this.#store.userByEmail(w.owner) : null;
      if (!u) throw new StoreError(400, "개인 워커는 주인(사람)을 골라야 합니다 — «사람» 화면에 있는 메일");
      owner = u.email;
    }
    if (w.team && !personal) this.#store.getTeam(w.team);
    const id = randomUUID();
    const token = newWorkerToken();
    try {
      this.#db.prepare("INSERT INTO worker (id, name, labels_json, slots, team_id, token_hash, created_at, kind, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, name, JSON.stringify(personal ? [] : labelsOf(w.labels ?? [])), slotsOf(w.slots ?? 1), personal ? null : w.team ?? null, workerTokenHash(token), now(), String(kind), owner);
    } catch (e) {
      if (/UNIQUE/.test(String(e))) throw new StoreError(409, `이미 있는 워커 이름입니다 — ${name}`);
      throw e;
    }
    return { worker: this.getWorker(id), token };
  }

  /** 이름 · 라벨 · 동시 실행 수 · 잠시 끄기 — 팀은 바꾸지 않는다(만들 때 정한다) */
  updateWorker(id: string, p: { name?: unknown; labels?: unknown; slots?: unknown; enabled?: unknown }): WorkerRow {
    this.getWorker(id);
    if (p.name !== undefined) {
      try { this.#db.prepare("UPDATE worker SET name = ? WHERE id = ?").run(workerName(p.name), id); } catch (e) {
        if (/UNIQUE/.test(String(e))) throw new StoreError(409, `이미 있는 워커 이름입니다 — ${String(p.name).trim()}`);
        throw e;
      }
    }
    if (p.labels !== undefined) {
      if (this.getWorker(id).kind === "personal" && labelsOf(p.labels).length > 0) throw new StoreError(400, "개인 워커에는 라벨을 붙이지 않습니다 — 주인이 «내 PC에서 실행하기»로 돌린 실행만 받습니다");
      this.#db.prepare("UPDATE worker SET labels_json = ? WHERE id = ?").run(JSON.stringify(labelsOf(p.labels)), id);
    }
    if (p.slots !== undefined) this.#db.prepare("UPDATE worker SET slots = ? WHERE id = ?").run(slotsOf(p.slots), id);
    if (p.enabled !== undefined) {
      if (typeof p.enabled !== "boolean") throw new StoreError(400, "enabled는 참 · 거짓입니다");
      this.#db.prepare("UPDATE worker SET enabled = ? WHERE id = ?").run(p.enabled ? 1 : 0, id);
    }
    return this.getWorker(id);
  }

  /** 새 토큰 — 옛 토큰은 그 순간 무효 */
  renewWorkerToken(id: string): string {
    this.getWorker(id);
    const token = newWorkerToken();
    this.#db.prepare("UPDATE worker SET token_hash = ? WHERE id = ?").run(workerTokenHash(token), id);
    return token;
  }

  /** ★이 워커에서 돌게 정해 둔 플로우가 있으면 지우지 않는다 */
  deleteWorker(id: string): void {
    const w = this.getWorker(id);
    if (w.flows > 0) throw new StoreError(409, `이 워커에서 도는 워크플로우가 ${w.flows}개 있습니다 — 그 워크플로우들의 «어디서 돌리나»를 먼저 바꾸세요`);
    this.#db.prepare("DELETE FROM worker WHERE id = ?").run(id);
  }

  workerByToken(token: string): WorkerRow | null {
    return this.#workerRows("WHERE w.token_hash = ?", workerTokenHash(token))[0] ?? null;
  }

  /** 붙었다 — 언제 · 어떤 PC */
  touchWorker(id: string, info?: WorkerInfo): void {
    if (info) this.#db.prepare("UPDATE worker SET last_seen_at = ?, info_json = ? WHERE id = ?").run(now(), JSON.stringify(info), id);
    else this.#db.prepare("UPDATE worker SET last_seen_at = ? WHERE id = ?").run(now(), id);
  }

  /** 플로우가 어디서 도나 — null이면 서버 */
  flowRunOn(flowId: string): string | null {
    return ((this.#db.prepare("SELECT run_on FROM flow WHERE id = ?").get(flowId) as Row | undefined)?.["run_on"] as string | null | undefined) ?? null;
  }

  /**
   * «어디서»가 이 플로우에 맞나 — 맞으면 고른 값(서버면 null), 아니면 400.
   * 「worker:<id>」 그 워커가 있고 팀이 맞아야 · 「label:<라벨>」 그 라벨이 붙은(팀이 맞는) 공용 워커가 하나는 있어야.
   * ★개인 워커 — 실행 한 번(run: 그 실행을 돌린 사람)으로만, 그것도 **주인이 돌린 실행만**. 워크플로우 설정으로는 고르지 못한다
   */
  checkRunOn(flowId: string, on: unknown, run?: { by: string | null }): string | null {
    if (on === null || on === undefined || on === "" || on === "server") return null;
    if (typeof on !== "string") throw new StoreError(400, "어디서 돌릴지를 읽을 수 없습니다");
    const team = this.#store.flowTeam(flowId) ?? null;
    if (on.startsWith("worker:")) {
      const w = this.getWorker(on.slice(7));
      if (w.kind === "personal") {
        if (!run) throw new StoreError(400, `«${w.name}»는 개인 워커입니다 — 워크플로우를 맡기지 않습니다(실행할 때 «내 PC에서 실행하기»로만 씁니다)`);
        if (!run.by || run.by.toLowerCase() !== w.owner?.toLowerCase()) throw new StoreError(400, `«${w.name}»는 ${w.owner ?? "다른 사람"}의 개인 워커입니다 — 그 사람이 직접 돌린 실행만 받습니다`);
        return on;
      }
      if (!workerFits(w.team?.id ?? null, team)) throw new StoreError(400, `«${w.name}»는 ${w.team!.name} 전용 워커입니다 — 이 워크플로우는 돌릴 수 없습니다`);
      return on;
    }
    if (on.startsWith("label:")) {
      const label = on.slice(6);
      if (!this.#workerRows().some((w) => w.kind === "shared" && w.labels.includes(label) && workerFits(w.team?.id ?? null, team))) throw new StoreError(400, `라벨 «${label}»이 붙은 워커가 없습니다`);
      return on;
    }
    throw new StoreError(400, `어디서 돌릴지를 읽을 수 없습니다 — ${on}`);
  }

  setFlowRunOn(flowId: string, on: unknown): string | null {
    this.#store.flowRow(flowId);
    const v = this.checkRunOn(flowId, on);
    this.#db.prepare("UPDATE flow SET run_on = ? WHERE id = ?").run(v, flowId);
    return v;
  }
}
