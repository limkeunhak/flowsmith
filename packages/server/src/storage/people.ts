/**
 * **사람 · 로그인 · 팀 — app_user · session · api_token · team · team_member** — Store(store.ts)가 겉모양이고, 이 저장소가 몸이다.
 * ★비밀번호 · 세션 토큰은 해시만 둔다.
 * 다른 표의 일은 `#store`를 거쳐 부른다(그 저장소가 맡는다).
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { now, type Row } from "./db.ts";
import { toUser } from "./rows.ts";
import { hashToken, newToken } from "../auth/tokens.ts";
import { StoreError, type ApiTokenRow, type TeamRow, type UserRole, type UserRow } from "./types.ts";
import type { Store } from "./store.ts";

export class PeopleRepo {
  readonly #db: DatabaseSync;
  readonly #store: Store;

  constructor(db: DatabaseSync, store: Store) {
    this.#db = db;
    this.#store = store;
  }

  /** 팀 · 사람 · 플로우 수를 한 번에 — where는 하나만 찾을 때 */
  #teamRows(where = "", ...args: string[]): TeamRow[] {
    return (this.#db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM flow f WHERE f.team_id = t.id) AS flows,
      (SELECT group_concat(m.user_id, char(31)) FROM team_member m WHERE m.team_id = t.id) AS members FROM team t ${where} ORDER BY t.name`).all(...args) as Row[]).map((t) => ({
      id: String(t["id"]), name: String(t["name"]), createdAt: String(t["created_at"]),
      members: t["members"] ? String(t["members"]).split("\u001f") : [],
      flows: Number(t["flows"]),
    }));
  }

  listTeams(): TeamRow[] { return this.#teamRows(); }

  getTeam(id: string): TeamRow {
    const t = this.#teamRows("WHERE t.id = ?", id)[0];
    if (!t) throw new StoreError(404, "없는 팀입니다");
    return t;
  }

  createTeam(name: string): TeamRow {
    const n = name.trim();
    if (!n) throw new StoreError(400, "팀 이름이 비었습니다");
    const id = randomUUID();
    try { this.#db.prepare("INSERT INTO team (id, name, created_at) VALUES (?, ?, ?)").run(id, n, now()); } catch (e) {
      if (/UNIQUE/.test(String(e))) throw new StoreError(409, `이미 있는 팀 이름입니다 — ${n}`);
      throw e;
    }
    return this.getTeam(id);
  }

  renameTeam(id: string, name: string): TeamRow {
    this.getTeam(id);
    const n = name.trim();
    if (!n) throw new StoreError(400, "팀 이름이 비었습니다");
    try { this.#db.prepare("UPDATE team SET name = ? WHERE id = ?").run(n, id); } catch (e) {
      if (/UNIQUE/.test(String(e))) throw new StoreError(409, `이미 있는 팀 이름입니다 — ${n}`);
      throw e;
    }
    return this.getTeam(id);
  }

  /** ★플로우가 남아 있으면 지우지 않는다 — 플로우를 다른 팀이나 공용으로 옮긴 뒤에 */
  deleteTeam(id: string): void {
    const t = this.getTeam(id);
    if (t.flows > 0) throw new StoreError(409, `이 팀에 워크플로우 ${t.flows}개가 있습니다 — 다른 팀이나 공용으로 옮긴 뒤에 지우세요`);
    const w = this.#store.listWorkers().filter((x) => x.team?.id === id);
    if (w.length > 0) throw new StoreError(409, `이 팀 전용 워커가 있습니다(${w.map((x) => x.name).join(", ")}) — 워커를 먼저 지우세요`);
    const su = this.#store.listSuites().filter((x) => x.team?.id === id);
    if (su.length > 0) throw new StoreError(409, `이 팀의 Suite가 있습니다(${su.map((x) => x.name).join(", ")}) — 옮기거나 지운 뒤에 지우세요`);
    this.#store.deleteSharedScope(id);   // 그 팀의 공용 값도
    this.#db.prepare("DELETE FROM team WHERE id = ?").run(id);
  }

  addMember(teamId: string, userId: string): void {
    this.getTeam(teamId);
    this.getUser(userId);
    this.#db.prepare("INSERT OR IGNORE INTO team_member (team_id, user_id) VALUES (?, ?)").run(teamId, userId);
  }

  removeMember(teamId: string, userId: string): void {
    this.#db.prepare("DELETE FROM team_member WHERE team_id = ? AND user_id = ?").run(teamId, userId);
  }

  /** 그 사람이 속한 팀들 */
  teamsOf(userId: string): { id: string; name: string }[] {
    return (this.#db.prepare("SELECT t.id, t.name FROM team t JOIN team_member m ON m.team_id = t.id WHERE m.user_id = ? ORDER BY t.name").all(userId) as Row[])
      .map((t) => ({ id: String(t["id"]), name: String(t["name"]) }));
  }

  countUsers(): number { return Number((this.#db.prepare("SELECT COUNT(*) AS n FROM app_user").get() as Row)["n"]); }

  insertUser(u: { email: string; name: string; role: UserRole; pwHash: string; mustChange: boolean }): UserRow {
    const id = randomUUID();
    try {
      this.#db.prepare("INSERT INTO app_user (id, email, name, role, pw_hash, must_change, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, u.email.toLowerCase(), u.name, u.role, u.pwHash, u.mustChange ? 1 : 0, now());
    } catch (e) {
      if (/UNIQUE/.test(String(e))) throw new StoreError(409, `이미 있는 메일입니다 — ${u.email}`);
      throw e;
    }
    return this.getUser(id);
  }

  getUser(id: string): UserRow {
    const r = this.#db.prepare("SELECT * FROM app_user WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new StoreError(404, "없는 사람입니다");
    return toUser(r);
  }

  /** 로그인할 때 — 해시까지 */
  userByEmail(email: string): (UserRow & { pwHash: string }) | null {
    const r = this.#db.prepare("SELECT * FROM app_user WHERE email = ?").get(email.trim().toLowerCase()) as Row | undefined;
    return r ? { ...toUser(r), pwHash: String(r["pw_hash"]) } : null;
  }

  listUsers(): UserRow[] {
    return (this.#db.prepare("SELECT * FROM app_user ORDER BY created_at").all() as Row[]).map(toUser);
  }

  updateUser(id: string, patch: { name?: string; role?: UserRole; disabled?: boolean; pwHash?: string; mustChange?: boolean }): UserRow {
    this.getUser(id);
    const sets: string[] = [], vals: (string | number)[] = [];
    if (patch.name !== undefined) { sets.push("name = ?"); vals.push(patch.name); }
    if (patch.role !== undefined) { sets.push("role = ?"); vals.push(patch.role); }
    if (patch.disabled !== undefined) { sets.push("disabled = ?"); vals.push(patch.disabled ? 1 : 0); }
    if (patch.pwHash !== undefined) { sets.push("pw_hash = ?"); vals.push(patch.pwHash); }
    if (patch.mustChange !== undefined) { sets.push("must_change = ?"); vals.push(patch.mustChange ? 1 : 0); }
    if (sets.length) this.#db.prepare(`UPDATE app_user SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
    return this.getUser(id);
  }

  touchLogin(id: string): void { this.#db.prepare("UPDATE app_user SET last_login_at = ? WHERE id = ?").run(now(), id); }

  insertSession(tokenHash: string, userId: string, expiresAt: string): void {
    this.#db.prepare("INSERT INTO session (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(tokenHash, userId, now(), expiresAt);
  }

  /** 살아 있는 로그인 — 끈 사람 · 지난 것은 없다 */
  sessionUser(tokenHash: string, at = now()): { user: UserRow; expiresAt: string } | null {
    const r = this.#db.prepare("SELECT u.*, s.expires_at AS s_exp FROM session s JOIN app_user u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0").get(tokenHash, at) as Row | undefined;
    return r ? { user: toUser(r), expiresAt: String(r["s_exp"]) } : null;
  }

  extendSession(tokenHash: string, expiresAt: string): void { this.#db.prepare("UPDATE session SET expires_at = ? WHERE token_hash = ?").run(expiresAt, tokenHash); }

  deleteSession(tokenHash: string): void { this.#db.prepare("DELETE FROM session WHERE token_hash = ?").run(tokenHash); }

  /** 그 사람의 로그인을 모두 끊는다 — 비밀번호를 바꾸거나 끌 때 */
  deleteSessionsOf(userId: string, except?: string): void {
    this.#db.prepare("DELETE FROM session WHERE user_id = ? AND token_hash != ?").run(userId, except ?? "");
  }

  pruneSessions(at = now()): number { return Number(this.#db.prepare("DELETE FROM session WHERE expires_at <= ?").run(at).changes); }

  // ─── API 토큰 ─────────────────────────────────────────────

  /** ★토큰 값은 여기서 한 번만 돌려준다 — DB에는 해시만 */
  createApiToken(t: { userId: string; name: string; role: UserRole; expiresAt: string | null }): { token: string; row: ApiTokenRow } {
    const id = randomUUID();
    const token = newToken("fsa_", 32);
    this.#db.prepare("INSERT INTO api_token (id, user_id, name, role, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, t.userId, t.name.slice(0, 100), t.role, hashToken(token), now(), t.expiresAt);
    return { token, row: this.listApiTokens(t.userId).find((r) => r.id === id)! };
  }

  listApiTokens(userId: string): ApiTokenRow[] {
    return (this.#db.prepare("SELECT * FROM api_token WHERE user_id = ? ORDER BY created_at DESC").all(userId) as Row[]).map((r) => ({
      id: String(r["id"]), userId: String(r["user_id"]), name: String(r["name"]), role: r["role"] as UserRole,
      createdAt: String(r["created_at"]), lastUsedAt: (r["last_used_at"] as string | null) ?? null, expiresAt: (r["expires_at"] as string | null) ?? null,
    }));
  }

  /** userId가 null이면 누구의 것이든(관리자) */
  deleteApiToken(id: string, userId: string | null): boolean {
    const r = userId === null ? this.#db.prepare("DELETE FROM api_token WHERE id = ?").run(id) : this.#db.prepare("DELETE FROM api_token WHERE id = ? AND user_id = ?").run(id, userId);
    return Number(r.changes) > 0;
  }

  /**
   * 토큰으로 사람 — 끈 사람 · 지난 토큰은 없다. 역할은 토큰과 그 사람의 **지금** 역할 중 낮은 쪽.
   * 마지막으로 쓴 때는 1분에 한 번만 적는다(요청마다 쓰지 않게).
   */
  apiTokenUser(tokenHash: string, at = now()): UserRow | null {
    const r = this.#db.prepare(`SELECT u.*, t.id AS t_id, t.role AS t_role, t.last_used_at AS t_used FROM api_token t JOIN app_user u ON u.id = t.user_id
      WHERE t.token_hash = ? AND (t.expires_at IS NULL OR t.expires_at > ?) AND u.disabled = 0`).get(tokenHash, at) as Row | undefined;
    if (!r) return null;
    const used = r["t_used"] ? Date.parse(String(r["t_used"])) : 0;
    if (Date.parse(at) - used > 60_000) this.#db.prepare("UPDATE api_token SET last_used_at = ? WHERE id = ?").run(at, String(r["t_id"]));
    const u = toUser(r);
    const tokenRole = r["t_role"] as UserRole;
    return { ...u, role: ROLE_RANK[tokenRole] < ROLE_RANK[u.role] ? tokenRole : u.role };
  }
}

const ROLE_RANK: Record<UserRole, number> = { viewer: 0, runner: 1, editor: 2, admin: 3 };
