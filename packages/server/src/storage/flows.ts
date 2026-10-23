/**
 * **플로우 · 버전 · 배포 · 시크릿(잠긴 값) — flow · flow_version · secret** — Store(store.ts)가 겉모양이고, 이 저장소가 몸이다.
 * ★버전을 읽을 때도 `parseFlow`를 다시 거친다(DB를 손으로 고쳤거나 스키마가 바뀌었을 수 있다) — 검문소는 «쓰기 전에 언제나»다.
 * 다른 표의 일은 `#store`를 거쳐 부른다(그 저장소가 맡는다).
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { checkFlow, FlowError, parseFlow, type Flow } from "@flowsmith/core";
import { visibleTo, workerFits } from "../rules/teams.ts";
import { now, tx, type Row } from "./db.ts";
import { headOf, canonical } from "./rows.ts";
import { StoreError, type FlowSummary, type FlowDetail, type ProbeRow, type PublishedFlow, type RunRow } from "./types.ts";
import type { Store } from "./store.ts";

export class FlowRepo {
  readonly #db: DatabaseSync;
  readonly #store: Store;
  /** 읽은 버전(검문소를 거친 Flow) — 「uid\0버전」 */
  readonly #versions = new Map<string, Flow>();
  /** 초안에서 목록이 읽는 것 — 「flow id → (초안 글자, 것)」 */
  readonly #facts = new Map<string, { json: string; facts: { problems: number; nodeTypes: string[]; schedules: string[] } }>();

  constructor(db: DatabaseSync, store: Store) {
    this.#db = db;
    this.#store = store;
  }

  /** 플로우 줄 — 없으면 404(다른 저장소도 쓴다) */
  flowRow(id: string): Row {
    const r = this.#db.prepare("SELECT * FROM flow WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new StoreError(404, `워크플로우 "${id}"가 없습니다`);
    return r;
  }

  /** teams — 이 팀들의 플로우와 공용만(null이면 전부 — 관리자 · 로그인 없이) */
  listFlows(teams: ReadonlySet<string> | null = null): FlowSummary[] {
    const rows = this.#db.prepare(`
      SELECT f.*, (SELECT MAX(version) FROM flow_version v WHERE v.flow_id = f.id) AS latest
      FROM flow f ORDER BY f.updated_at DESC`).all() as Row[];
    // ★플로우마다 묻지 않는다 — 마지막 실행 · 마지막 점검을 한 번에(SQLite는 MAX와 같은 줄의 칸을 준다)
    const last = new Map((this.#db.prepare("SELECT flow_id, status, MAX(started_at) AS at FROM run WHERE status != 'running' GROUP BY flow_id").all() as Row[]).map((x) => [String(x["flow_id"]), x]));
    const probe = new Map((this.#db.prepare("SELECT flow_id, status, source, MAX(at) AS at FROM probe WHERE status != 'running' GROUP BY flow_id").all() as Row[]).map((x) => [String(x["flow_id"]), x]));
    const teamName = new Map((this.#db.prepare("SELECT id, name FROM team").all() as Row[]).map((t) => [String(t["id"]), String(t["name"])]));
    return rows.filter((r) => visibleTo(teams, (r["team_id"] as string | null) ?? null)).map((r) => {
      const d = this.#draftFacts(String(r["id"]), String(r["draft_json"]));
      const lr = last.get(String(r["id"]));
      const p = probe.get(String(r["id"]));
      return {
        id: String(r["id"]),
        name: String(r["name"]),
        activeVersion: (r["active_version"] as number | null) ?? null,
        latestVersion: (r["latest"] as number | null) ?? null,
        problems: d.problems,
        updatedAt: String(r["updated_at"]),
        monitor: p ? { status: p["status"] as ProbeRow["status"], at: String(p["at"]), source: p["source"] as ProbeRow["source"] } : null,
        // 목록이 그림을 그리는 데 쓴다 — 쓰인 노드 종류(나온 차례) · 켜 둔 일정 · 마지막 실행
        nodeTypes: d.nodeTypes,
        schedules: d.schedules,
        lastRun: lr ? { status: lr["status"] as RunRow["status"], at: String(lr["at"]) } : null,
        team: r["team_id"] === null ? null : { id: String(r["team_id"]), name: teamName.get(String(r["team_id"])) ?? "(없는 팀)" },
        runOn: (r["run_on"] as string | null) ?? null,
      };
    });
  }

  /** 초안에서 목록이 읽는 것(문제 수 · 노드 종류 · 일정) — 초안이 바뀔 때만 다시 센다(글자를 견준다 — 검사보다 훨씬 싸다) */
  #draftFacts(id: string, json: string): { problems: number; nodeTypes: string[]; schedules: string[] } {
    const hit = this.#facts.get(id);
    if (hit && hit.json === json) return hit.facts;
    const draft = JSON.parse(json) as { nodes?: { type?: unknown }[]; settings?: { schedules?: { cron?: unknown; enabled?: unknown }[] } };
    const facts = {
      problems: checkFlow(draft).length,
      nodeTypes: [...new Set((Array.isArray(draft.nodes) ? draft.nodes : []).map((n) => String(n?.type ?? "")).filter(Boolean))],
      schedules: (Array.isArray(draft.settings?.schedules) ? draft.settings.schedules : []).filter((s) => s?.enabled !== false && typeof s?.cron === "string").map((s) => String(s.cron)),
    };
    this.#facts.set(id, { json, facts });
    return facts;
  }

  /** 플로우 이름만 — 보이는 것(팀) · 대시보드처럼 이름만 쓰는 곳 */
  flowNames(teams: ReadonlySet<string> | null = null): { id: string; name: string }[] {
    return (this.#db.prepare("SELECT id, name, team_id FROM flow ORDER BY updated_at DESC").all() as Row[])
      .filter((r) => visibleTo(teams, (r["team_id"] as string | null) ?? null)).map((r) => ({ id: String(r["id"]), name: String(r["name"]) }));
  }

  getFlow(id: string): FlowDetail {
    const r = this.flowRow(id);
    const draft = JSON.parse(String(r["draft_json"]));
    const versions = (this.#db.prepare("SELECT version, note, created_at, created_by, plugins_json FROM flow_version WHERE flow_id = ? ORDER BY version DESC").all(id) as Row[])
      .map((v) => ({ version: Number(v["version"]), note: String(v["note"]), createdAt: String(v["created_at"]), createdBy: (v["created_by"] as string | null) ?? null,
        plugins: v["plugins_json"] ? JSON.parse(String(v["plugins_json"])) as Record<string, string> : {} }));
    const latest = versions[0] ? this.#versionJson(id, versions[0].version) : null;
    return {
      id, name: String(r["name"]), uid: String(r["uid"]), draft, problems: checkFlow(draft),
      activeVersion: (r["active_version"] as number | null) ?? null,
      deployedAt: (r["deployed_at"] as string | null) ?? null, deployedBy: (r["deployed_by"] as string | null) ?? null,
      versions,
      draftChanged: latest === null || canonical(JSON.parse(latest)) !== canonical(draft),
      createdAt: String(r["created_at"]), updatedAt: String(r["updated_at"]), updatedBy: (r["updated_by"] as string | null) ?? null,
      team: r["team_id"] === null || r["team_id"] === undefined ? null : { id: String(r["team_id"]), name: this.#teamName(String(r["team_id"])) },
      runOn: (r["run_on"] as string | null) ?? null,
      pins: this.#pinsOf(r),
    };
  }

  #pinsOf(r: Row): Record<string, Record<string, unknown>> {
    try { return r["pins_json"] ? (JSON.parse(String(r["pins_json"])) as Record<string, Record<string, unknown>>) : {}; } catch { return {}; }
  }

  /** 고정된 출력 — 노드 id → 출력 */
  flowPins(id: string): Record<string, Record<string, unknown>> { return this.#pinsOf(this.flowRow(id)); }

  /** 노드의 출력을 고정하거나(output) 푼다(null) */
  setPin(id: string, nodeId: string, output: Record<string, unknown> | null): Record<string, Record<string, unknown>> {
    const pins = this.flowPins(id);
    if (output === null) delete pins[nodeId]; else pins[nodeId] = output;
    this.#db.prepare("UPDATE flow SET pins_json = ? WHERE id = ?").run(Object.keys(pins).length ? JSON.stringify(pins) : null, id);
    return pins;
  }

  #teamName(id: string): string { return String((this.#db.prepare("SELECT name FROM team WHERE id = ?").get(id) as Row | undefined)?.["name"] ?? "(없는 팀)"); }

  /** team — 속할 팀(없으면 공용) */
  createFlow(draft: unknown, team: string | null = null): FlowDetail {
    const { id, name } = headOf(draft);
    const exists = this.#db.prepare("SELECT 1 FROM flow WHERE id = ?").get(id);
    if (exists) throw new StoreError(409, `워크플로우 "${id}"가 이미 있습니다`);
    const t = now();
    // ★uid는 늘 새로 — 들어온 JSON에 무엇이 있든(복사한 플로우가 원래 플로우의 파일에 쓰지 않게)
    if (team !== null) this.#store.getTeam(team);
    this.#db.prepare("INSERT INTO flow (id, name, draft_json, active_version, uid, created_at, updated_at, team_id) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)")
      .run(id, name, JSON.stringify(draft), randomUUID(), t, t, team);
    return this.getFlow(id);
  }

  /** 저장 노드의 폴더 이름 */
  flowUid(id: string): string {
    return String(this.flowRow(id)["uid"]);
  }

  /** by — 고친 사람(메일). 로그인 없이 쓰면 null */
  saveDraft(id: string, draft: unknown, by: string | null = null): FlowDetail {
    this.flowRow(id);
    const head = headOf(draft);
    if (head.id !== id) throw new StoreError(400, `초안의 id "${head.id}"가 주소의 "${id}"와 다릅니다 — id는 바꿀 수 없습니다`);
    this.#db.prepare("UPDATE flow SET name = ?, draft_json = ?, updated_at = ?, updated_by = ? WHERE id = ?").run(head.name, JSON.stringify(draft), now(), by, id);
    return this.getFlow(id);
  }

  deleteFlow(id: string): void {
    this.flowRow(id);
    this.#db.prepare("DELETE FROM flow WHERE id = ?").run(id);
  }

  /** 초안을 굳힌다. ★검문소를 통과해야 한다. 마지막 버전과 같으면 만들지 않는다 */
  /** plugins — 이 버전이 쓰는 확장 플러그인의 지금 버전(run/plugins.ts versionsFor). 나중에 바뀌면 편집 화면이 알린다 */
  createVersion(id: string, note: string, by: string | null = null, plugins: (flow: Flow) => Record<string, string> = () => ({})): number {
    return tx(this.#db, () => {
      const r = this.flowRow(id);
      const draft = JSON.parse(String(r["draft_json"]));
      let parsed: Flow;
      try { parsed = parseFlow(draft); } catch (e) {
        if (e instanceof FlowError) throw new StoreError(422, "초안에 문제가 있어 버전을 만들 수 없습니다", e.problems);
        throw e;
      }
      const latest = this.#db.prepare("SELECT MAX(version) AS v FROM flow_version WHERE flow_id = ?").get(id) as Row;
      const prev = latest["v"] === null ? null : Number(latest["v"]);
      if (prev !== null && canonical(JSON.parse(this.#versionJson(id, prev))) === canonical(draft)) {
        throw new StoreError(409, `바뀐 것이 없습니다 — 버전 ${prev}과 같습니다`);
      }
      const version = (prev ?? 0) + 1;
      this.#db.prepare("INSERT INTO flow_version (flow_id, version, manifest_json, note, created_at, created_by, plugins_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, version, JSON.stringify(draft), note, now(), by, JSON.stringify(plugins(parsed)));
      return version;
    });
  }

  #versionJson(id: string, version: number): string {
    const v = this.#db.prepare("SELECT manifest_json FROM flow_version WHERE flow_id = ? AND version = ?").get(id, version) as Row | undefined;
    if (!v) throw new StoreError(404, `워크플로우 "${id}"에 버전 ${version}이 없습니다`);
    return String(v["manifest_json"]);
  }

  /**
   * 버전을 Flow로 — ★다시 검문소를 거친다(이 프로세스에서 처음 읽을 때 한 번).
   * 버전은 바뀌지 않으니 읽은 것을 기억한다 — 일정 · 감시가 몇 초마다 같은 버전을 다시 읽는다.
   * 열쇠에 플로우의 uid를 넣는다(지우고 같은 id로 다시 만든 플로우가 옛 버전을 받지 않게) · 내줄 때는 사본(고쳐도 남에게 번지지 않게)
   */
  getVersion(id: string, version: number): Flow {
    const key = `${String(this.flowRow(id)["uid"])}\u0000${version}`;
    let flow = this.#versions.get(key);
    if (!flow) {
      try { flow = parseFlow(JSON.parse(this.#versionJson(id, version))); } catch (e) {
        if (e instanceof FlowError) throw new StoreError(500, `저장된 버전 ${version}이 지금 검사를 통과하지 못합니다`, e.problems);
        throw e;
      }
      this.#versions.set(key, flow);
    }
    return structuredClone(flow);
  }

  getVersionJson(id: string, version: number): unknown {
    return JSON.parse(this.#versionJson(id, version));
  }

  /** 초안을 Flow로 — 시험 실행용. 틀려 있으면 던진다 */
  getDraftFlow(id: string): Flow {
    const r = this.flowRow(id);
    try { return parseFlow(JSON.parse(String(r["draft_json"]))); } catch (e) {
      if (e instanceof FlowError) throw new StoreError(422, "초안에 문제가 있어 돌릴 수 없습니다", e.problems);
      throw e;
    }
  }

  /** by — 게시한 사람(메일). 내릴 때(null)도 언제 · 누가를 남긴다(감사 기록) */
  deploy(id: string, version: number | null, by: string | null = null): void {
    this.flowRow(id);
    if (version !== null) this.#versionJson(id, version);
    const t = now();
    this.#db.prepare("UPDATE flow SET active_version = ?, updated_at = ?, deployed_at = ?, deployed_by = ? WHERE id = ?").run(version, t, t, by, id);
  }

  /**
   * 게시된 버전 — 밖의 시스템이 한 번에 받아 간다(GET /api/flows/:id/published). 게시하지 않았거나 내렸으면 null.
   * ★매니페스트는 getVersion을 거친다 — 저장된 JSON을 그대로가 아니라 지금 검문소를 통과한 모양으로
   */
  published(id: string): PublishedFlow | null {
    const r = this.flowRow(id);
    const version = (r["active_version"] as number | null) ?? null;
    if (version === null) return null;
    const v = this.#db.prepare("SELECT note, created_at, created_by FROM flow_version WHERE flow_id = ? AND version = ?").get(id, version) as Row;
    return {
      flowId: id, uid: String(r["uid"]), version, note: String(v["note"]), createdAt: String(v["created_at"]), createdBy: (v["created_by"] as string | null) ?? null,
      deployedAt: (r["deployed_at"] as string | null) ?? null, deployedBy: (r["deployed_by"] as string | null) ?? null,
      manifest: this.getVersion(id, version),
    };
  }

  activeVersion(id: string): number | null {
    return (this.flowRow(id)["active_version"] as number | null) ?? null;
  }

  putSealed(flowId: string, name: string, sealed: string): string {
    this.flowRow(flowId);
    const t = now();
    this.#db.prepare(`INSERT INTO secret (flow_id, name, sealed, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(flow_id, name) DO UPDATE SET sealed = excluded.sealed, updated_at = excluded.updated_at`).run(flowId, name, sealed, t);
    return t;
  }

  /** 이름과 저장 시각만 — 값은 이 길로 안 나간다 */
  listSecretNames(flowId: string): { name: string; updatedAt: string }[] {
    this.flowRow(flowId);
    return (this.#db.prepare("SELECT name, updated_at FROM secret WHERE flow_id = ? ORDER BY name").all(flowId) as Row[])
      .map((r) => ({ name: String(r["name"]), updatedAt: String(r["updated_at"]) }));
  }

  /** 실행할 때만 — 잠긴 채로 돌려준다. 푸는 건 부르는 쪽(SecretBox) */
  sealedSecrets(flowId: string): Map<string, string> {
    const rows = this.#db.prepare("SELECT name, sealed FROM secret WHERE flow_id = ?").all(flowId) as Row[];
    return new Map(rows.map((r) => [String(r["name"]), String(r["sealed"])]));
  }

  deleteSecret(flowId: string, name: string): boolean {
    this.flowRow(flowId);
    return this.#db.prepare("DELETE FROM secret WHERE flow_id = ? AND name = ?").run(flowId, name).changes > 0;
  }

  /** 게시된 플로우들 — 감시할 후보 */
  activeFlows(): { id: string; version: number }[] {
    return (this.#db.prepare("SELECT id, active_version FROM flow WHERE active_version IS NOT NULL").all() as Row[])
      .map((r) => ({ id: String(r["id"]), version: Number(r["active_version"]) }));
  }

  /** 플로우의 팀 — null이면 공용. 없는 플로우면 undefined */
  flowTeam(flowId: string): string | null | undefined {
    const r = this.#db.prepare("SELECT team_id FROM flow WHERE id = ?").get(flowId) as Row | undefined;
    return r ? ((r["team_id"] as string | null) ?? null) : undefined;
  }

  setFlowTeam(flowId: string, team: string | null): void {
    const r = this.flowRow(flowId);
    if (team !== null) this.#store.getTeam(team);
    // ★그 팀이 쓸 수 없는 워커에서 돌게 돼 있으면 옮기지 않는다 — 조용히 «서버»로 바꾸지 않는다
    const on = (r["run_on"] as string | null) ?? null;
    if (on?.startsWith("worker:")) {
      const w = this.#store.findWorker(on.slice(7));
      if (w && !workerFits(w.team?.id ?? null, team)) throw new StoreError(409, `이 워크플로우는 «${w.name}»(${w.team!.name} 전용)에서 돕니다 — 먼저 «어디서 돌리나»를 바꾸세요`);
    }
    this.#db.prepare("UPDATE flow SET team_id = ? WHERE id = ?").run(team, flowId);
  }

  flowIdByUid(uid: string): string | null { return ((this.#db.prepare("SELECT id FROM flow WHERE uid = ?").get(uid) as Row | undefined)?.["id"] as string | undefined) ?? null; }
}
