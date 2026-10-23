/**
 * **팀 공용 값** — 여러 플로우가 함께 쓰는 변수 · 시크릿(Jenkins credentials의 폴더 범위 · Airflow Variables · Connections).
 *
 *   scope   팀 id · ""(모두 — 공용). 플로우는 **제 팀 → 공용** 차례로 찾는다(같은 이름이면 팀 것이 이긴다)
 *   var     값을 그대로 둔다(보는 사람도 읽는다 — 시크릿이 아닌 것만)
 *   secret  잠근 값(SecretBox · AAD `shared/<scope>/<name>`). ★값이 밖으로 나가는 길이 없다 — 실행할 때만 풀린다(secrets.ts)
 */
import type { DatabaseSync } from "node:sqlite";
import type { SecretKind } from "@flowsmith/core";
import { now, type Row } from "./db.ts";

export type SharedKind = "var" | "secret";

export interface SharedRow {
  scope: string;
  kind: SharedKind;
  name: string;
  /** 시크릿의 종류(text · login) — 변수는 null */
  secretKind: SecretKind | null;
  description: string;
  /** 변수만 — 시크릿은 늘 null */
  value: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

const toRow = (r: Row): SharedRow => ({
  scope: String(r["scope"]), kind: String(r["kind"]) as SharedKind, name: String(r["name"]),
  secretKind: r["secret_kind"] === null ? null : (String(r["secret_kind"]) as SecretKind),
  description: String(r["description"]),
  value: r["kind"] === "var" ? String(r["value"]) : null,
  updatedAt: String(r["updated_at"]), updatedBy: r["updated_by"] === null ? null : String(r["updated_by"]),
});

export class SharedRepo {
  readonly #db: DatabaseSync;
  constructor(db: DatabaseSync) { this.#db = db; }

  /** 목록 — 시크릿 값은 없다. scopes가 있으면 그 범위만 */
  listShared(scopes: readonly string[] | null = null): SharedRow[] {
    const rows = this.#db.prepare("SELECT * FROM shared_value ORDER BY scope, kind, name").all() as Row[];
    return rows.map(toRow).filter((r) => scopes === null || scopes.includes(r.scope));
  }

  putShared(v: { scope: string; kind: SharedKind; name: string; secretKind: SecretKind | null; description: string; value: string; by: string | null }): string {
    const t = now();
    this.#db.prepare(`INSERT INTO shared_value (scope, kind, name, secret_kind, description, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, kind, name) DO UPDATE SET secret_kind = excluded.secret_kind, description = excluded.description, value = excluded.value,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by`).run(v.scope, v.kind, v.name, v.secretKind, v.description, v.value, t, v.by);
    return t;
  }

  /** 시크릿의 잠긴 값 · 종류 — 실행할 때만(secrets.ts) */
  sealedShared(scope: string, name: string): { sealed: string; kind: SecretKind } | null {
    const r = this.#db.prepare("SELECT value, secret_kind FROM shared_value WHERE scope = ? AND kind = 'secret' AND name = ?").get(scope, name) as Row | undefined;
    return r ? { sealed: String(r["value"]), kind: String(r["secret_kind"]) as SecretKind } : null;
  }

  sharedVar(scope: string, name: string): string | null {
    const r = this.#db.prepare("SELECT value FROM shared_value WHERE scope = ? AND kind = 'var' AND name = ?").get(scope, name) as Row | undefined;
    return r ? String(r["value"]) : null;
  }

  deleteShared(scope: string, kind: SharedKind, name: string): boolean {
    return this.#db.prepare("DELETE FROM shared_value WHERE scope = ? AND kind = ? AND name = ?").run(scope, kind, name).changes > 0;
  }

  /** 팀을 지울 때 — 그 팀의 값도 */
  deleteSharedScope(scope: string): void {
    this.#db.prepare("DELETE FROM shared_value WHERE scope = ?").run(scope);
  }
}
