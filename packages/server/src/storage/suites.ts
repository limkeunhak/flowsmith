/**
 * **Suite** — 웹 e2e 테스트 묶음(PLAN §39). 팀마다 여러 개 · 시나리오(게시된 플로우) 목록과 순서 · 실행 입력 · 일정 · 알림.
 *
 *   suite       묶음 하나 — 이름 · 팀(없으면 공용) · items · schedules · notify(JSON)
 *   suite_run   한 번 돈 것 — 상태(running · pass · fail · error · cancelled) · 어떻게 · 누가 · 시나리오마다의 판정(items_json)
 *   suite_fire  일정이 같은 분에 두 번 돌지 않게
 *
 * ★시나리오는 **게시된 버전**만 돈다 — 고치는 중인 초안이 테스트를 흔들지 않게.
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { NAME_RE, NOTIFY_CHANNELS, parseCron, type NotifyRule, type Verdict } from "@flowsmith/core";
import { now, type Row } from "./db.ts";
import { StoreError } from "./types.ts";

export interface SuiteItem {
  id: string;
  flowId: string;
  /** 사람이 부르는 이름 — 없으면 플로우 이름 */
  label: string;
  /** 이 시나리오의 실행 입력(같은 플로우를 입력만 바꿔 여러 번 넣을 수 있다) */
  params: Record<string, string>;
  enabled: boolean;
}
export interface SuiteSchedule { id: string; cron: string; enabled: boolean }
/** 알림 — 언제는 failure(불통과 · 오류가 하나라도) · recovered(앞이 통과 아님 → 통과) · success(통과) */
export type SuiteNotifyRule = Omit<NotifyRule, "on" | "attach" | "firstOnly"> & { on: ("failure" | "recovered" | "success")[] };

export interface Suite {
  id: string;
  name: string;
  description: string;
  team: { id: string; name: string } | null;
  items: SuiteItem[];
  schedules: SuiteSchedule[];
  notify: SuiteNotifyRule[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

export type SuiteRunStatus = "running" | "pass" | "fail" | "error" | "cancelled";
export interface SuiteRunItem {
  itemId: string;
  flowId: string;
  label: string;
  /** 시나리오의 실행 — 시작도 못 했으면 null */
  runId: string | null;
  verdict: Verdict | "running" | "pending" | "skipped";
  message: string;
  ms: number | null;
  /** 검사 — 맞은 수 · 틀린 수(검사 노드가 없으면 0 · 0) */
  checks: { passed: number; failed: number };
}
export interface SuiteRun {
  id: string;
  suiteId: string;
  status: SuiteRunStatus;
  trigger: "manual" | "schedule" | "api";
  /** 단건 실행이면 그 시나리오 id */
  only: string | null;
  startedBy: string | null;
  startedAt: string;
  finishedAt: string | null;
  ms: number | null;
  items: SuiteRunItem[];
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** 받은 것을 읽는다 — 틀리면 400(문제들) */
export function readSuiteBody(b: Record<string, unknown>, cur: Pick<Suite, "name" | "description" | "items" | "schedules" | "notify">): Pick<Suite, "name" | "description" | "items" | "schedules" | "notify"> {
  const problems: string[] = [];
  const name = b["name"] === undefined ? cur.name : str(b["name"]).trim();
  if (!name) problems.push("이름이 비었습니다");
  const description = b["description"] === undefined ? cur.description : str(b["description"]);
  const items: SuiteItem[] = b["items"] === undefined ? cur.items : (Array.isArray(b["items"]) ? b["items"] : []).map((x, i) => {
    const o = isObj(x) ? x : {};
    const id = str(o["id"]) || `i${i + 1}`;
    if (!ID.test(id)) problems.push(`시나리오 ${i + 1}: id "${id}"는 영문 소문자 · 숫자 · - 만`);
    const flowId = str(o["flowId"]);
    if (!flowId) problems.push(`시나리오 ${i + 1}: 워크플로우를 고르세요`);
    const params = isObj(o["params"]) ? Object.fromEntries(Object.entries(o["params"]).map(([k, v]) => [k, typeof v === "string" ? v : String(v ?? "")])) : {};
    return { id, flowId, label: str(o["label"]), params, enabled: o["enabled"] !== false };
  });
  if (new Set(items.map((x) => x.id)).size !== items.length) problems.push("시나리오 id가 겹칩니다");
  const schedules: SuiteSchedule[] = b["schedules"] === undefined ? cur.schedules : (Array.isArray(b["schedules"]) ? b["schedules"] : []).map((x, i) => {
    const o = isObj(x) ? x : {};
    const cron = str(o["cron"]).trim();
    try { parseCron(cron); } catch (e) { problems.push(`일정 ${i + 1}: ${(e as Error).message}`); }
    return { id: str(o["id"]) || `s${i + 1}`, cron, enabled: o["enabled"] !== false };
  });
  const notify: SuiteNotifyRule[] = b["notify"] === undefined ? cur.notify : (Array.isArray(b["notify"]) ? b["notify"] : []).map((x, i) => {
    const o = isObj(x) ? x : {};
    const channel = str(o["channel"]) as NotifyRule["channel"];
    if (!(NOTIFY_CHANNELS as readonly string[]).includes(channel)) problems.push(`알림 ${i + 1}: 어디로(${NOTIFY_CHANNELS.join(" · ")})`);
    const url = str(o["url"]).trim();
    if (!url) problems.push(`알림 ${i + 1}: 주소(받는 사람)가 비었습니다`);
    if (url.includes("{{")) problems.push(`알림 ${i + 1}: Suite 알림 주소에는 표현식을 쓸 수 없습니다 — 주소를 그대로 적으세요`);
    const on = (Array.isArray(o["on"]) ? o["on"] : []).filter((e): e is "failure" | "recovered" | "success" => e === "failure" || e === "recovered" || e === "success");
    if (on.length === 0) problems.push(`알림 ${i + 1}: 언제(불통과 · 회복 · 통과)를 하나 이상 고르세요`);
    return { id: str(o["id"]) || `n${i + 1}`, channel, url, on, enabled: o["enabled"] !== false };
  });
  if (problems.length) throw new StoreError(400, "Suite를 저장할 수 없습니다", problems);
  return { name, description, items, schedules, notify };
}

const toSuite = (r: Row, teamName: (id: string) => string | null): Suite => ({
  id: String(r["id"]), name: String(r["name"]), description: String(r["description"]),
  team: r["team_id"] === null ? null : { id: String(r["team_id"]), name: teamName(String(r["team_id"])) ?? "" },
  items: JSON.parse(String(r["items_json"])), schedules: JSON.parse(String(r["schedules_json"])), notify: JSON.parse(String(r["notify_json"])),
  createdAt: String(r["created_at"]), updatedAt: String(r["updated_at"]), updatedBy: r["updated_by"] === null ? null : String(r["updated_by"]),
});
const toRun = (r: Row): SuiteRun => ({
  id: String(r["id"]), suiteId: String(r["suite_id"]), status: String(r["status"]) as SuiteRunStatus, trigger: String(r["trigger"]) as SuiteRun["trigger"],
  only: r["only_item"] === null ? null : String(r["only_item"]), startedBy: r["started_by"] === null ? null : String(r["started_by"]),
  startedAt: String(r["started_at"]), finishedAt: r["finished_at"] === null ? null : String(r["finished_at"]), ms: r["ms"] === null ? null : Number(r["ms"]),
  items: JSON.parse(String(r["items_json"])),
});

export class SuiteRepo {
  readonly #db: DatabaseSync;
  readonly #teamName: (id: string) => string | null;
  constructor(db: DatabaseSync, teamName: (id: string) => string | null) { this.#db = db; this.#teamName = teamName; }

  listSuites(): Suite[] {
    return (this.#db.prepare("SELECT * FROM suite ORDER BY name").all() as Row[]).map((r) => toSuite(r, this.#teamName));
  }

  getSuite(id: string): Suite {
    const r = this.#db.prepare("SELECT * FROM suite WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new StoreError(404, "없는 Suite입니다");
    return toSuite(r, this.#teamName);
  }

  createSuite(name: string, teamId: string | null, by: string | null): Suite {
    if (!name.trim()) throw new StoreError(400, "이름이 비었습니다");
    const id = `suite-${randomUUID().slice(0, 8)}`;
    const t = now();
    this.#db.prepare("INSERT INTO suite (id, name, description, team_id, items_json, schedules_json, notify_json, created_at, updated_at, updated_by) VALUES (?, ?, '', ?, '[]', '[]', '[]', ?, ?, ?)")
      .run(id, name.trim(), teamId, t, t, by);
    return this.getSuite(id);
  }

  updateSuite(id: string, s: Pick<Suite, "name" | "description" | "items" | "schedules" | "notify">, teamId: string | null | undefined, by: string | null): Suite {
    this.getSuite(id);
    this.#db.prepare(`UPDATE suite SET name = ?, description = ?, items_json = ?, schedules_json = ?, notify_json = ?, updated_at = ?, updated_by = ?${teamId !== undefined ? ", team_id = ?" : ""} WHERE id = ?`)
      .run(s.name, s.description, JSON.stringify(s.items), JSON.stringify(s.schedules), JSON.stringify(s.notify), now(), by, ...(teamId !== undefined ? [teamId] : []), id);
    return this.getSuite(id);
  }

  deleteSuite(id: string): void {
    if (this.#db.prepare("DELETE FROM suite WHERE id = ?").run(id).changes === 0) throw new StoreError(404, "없는 Suite입니다");
  }

  insertSuiteRun(r: Omit<SuiteRun, "finishedAt" | "ms" | "status">): void {
    this.#db.prepare("INSERT INTO suite_run (id, suite_id, status, trigger, only_item, started_by, started_at, items_json) VALUES (?, ?, 'running', ?, ?, ?, ?, ?)")
      .run(r.id, r.suiteId, r.trigger, r.only, r.startedBy, r.startedAt, JSON.stringify(r.items));
  }

  updateSuiteRun(id: string, items: SuiteRunItem[], done: { status: SuiteRunStatus; ms: number } | null = null): void {
    if (done) this.#db.prepare("UPDATE suite_run SET items_json = ?, status = ?, finished_at = ?, ms = ? WHERE id = ?").run(JSON.stringify(items), done.status, now(), done.ms, id);
    else this.#db.prepare("UPDATE suite_run SET items_json = ? WHERE id = ?").run(JSON.stringify(items), id);
  }

  getSuiteRun(id: string): SuiteRun {
    const r = this.#db.prepare("SELECT * FROM suite_run WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new StoreError(404, "없는 Suite 실행입니다");
    return toRun(r);
  }

  listSuiteRuns(suiteId: string, limit = 30): SuiteRun[] {
    return (this.#db.prepare("SELECT * FROM suite_run WHERE suite_id = ? ORDER BY started_at DESC LIMIT ?").all(suiteId, limit) as Row[]).map(toRun);
  }

  /** 마지막으로 끝난 전체 실행의 상태(단건 · 도는 중 · 멈춤은 빼고) — 알림의 «회복» */
  previousSuiteStatus(suiteId: string, runId: string): SuiteRunStatus | null {
    const r = this.#db.prepare("SELECT status FROM suite_run WHERE suite_id = ? AND id != ? AND only_item IS NULL AND status IN ('pass', 'fail', 'error') ORDER BY started_at DESC LIMIT 1").get(suiteId, runId) as Row | undefined;
    return r ? (String(r["status"]) as SuiteRunStatus) : null;
  }

  /** 서버가 꺼지며 끝나지 못한 실행 — 다시 켤 때 «멈춤»으로 */
  abandonSuiteRuns(): void {
    this.#db.prepare("UPDATE suite_run SET status = 'cancelled', finished_at = ? WHERE status = 'running'").run(now());
  }

  claimSuiteFire(suiteId: string, scheduleId: string, minute: string): boolean {
    return this.#db.prepare("INSERT OR IGNORE INTO suite_fire (suite_id, schedule_id, minute, at) VALUES (?, ?, ?, ?)").run(suiteId, scheduleId, minute, now()).changes > 0;
  }
}

export { NAME_RE };
