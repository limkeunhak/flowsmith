/**
 * 플러그인 기록(run/plugins.ts) — 올린 버전마다 한 줄 · 플러그인마다 지금 쓰는 버전 · 켬/끔 · 감사 기록.
 * 묶음 파일은 데이터 폴더/plugins/<id>/<version>.fspkg(풀어 둔 것은 그 옆 폴더). 여기에는 manifest · 해시 · 누가 · 어디서만.
 */
import type { DatabaseSync } from "node:sqlite";
import type { PluginManifest } from "@flowsmith/worker";

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();

export interface PluginVersionRow {
  id: string;
  version: string;
  sha256: string;
  manifest: PluginManifest;
  /** 서명한 키 이름 — 서명 없이 받았으면 null */
  signer: string | null;
  size: number;
  /** "upload" · 사내 저장소 주소 */
  source: string;
  installedAt: string;
  installedBy: string | null;
}

export interface PluginRow {
  id: string;
  active: string;
  enabled: boolean;
  changedAt: string;
  changedBy: string | null;
}

export interface PluginEvent { at: string; action: string; plugin: string; version: string | null; by: string | null; note: string }

export const PLUGIN_SCHEMA = `
CREATE TABLE IF NOT EXISTS plugin (               -- 플러그인(run/plugins.ts) — 지금 쓰는 버전 · 켬/끔
  id              TEXT PRIMARY KEY,
  active          TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  changed_at      TEXT NOT NULL,
  changed_by      TEXT
);
CREATE TABLE IF NOT EXISTS plugin_version (       -- 올린 버전마다 — 묶음은 데이터 폴더/plugins/<id>/<version>.fspkg. 올린 것은 바꾸지 않는다
  id              TEXT NOT NULL,
  version         TEXT NOT NULL,
  sha256          TEXT NOT NULL,
  manifest_json   TEXT NOT NULL,
  signer          TEXT,
  size            INTEGER NOT NULL,
  source          TEXT NOT NULL,
  installed_at    TEXT NOT NULL,
  installed_by    TEXT,
  PRIMARY KEY (id, version)
);
CREATE TABLE IF NOT EXISTS plugin_event (         -- 설치 · 바꾸기 · 켜기/끄기 · 지우기 — 감사 기록
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  at              TEXT NOT NULL,
  action          TEXT NOT NULL,
  plugin          TEXT NOT NULL,
  version         TEXT,
  note            TEXT NOT NULL,
  by_email        TEXT
);
CREATE TABLE IF NOT EXISTS app_setting (          -- 화면에서 정하는 서버 설정 한 줄씩(사내 저장소 주소 등)
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL
);
`;

const versionOf = (r: Row): PluginVersionRow => ({
  id: String(r["id"]), version: String(r["version"]), sha256: String(r["sha256"]),
  manifest: JSON.parse(String(r["manifest_json"])) as PluginManifest,
  signer: r["signer"] === null ? null : String(r["signer"]), size: Number(r["size"]), source: String(r["source"]),
  installedAt: String(r["installed_at"]), installedBy: r["installed_by"] === null ? null : String(r["installed_by"]),
});
const pluginOf = (r: Row): PluginRow => ({
  id: String(r["id"]), active: String(r["active"]), enabled: Number(r["enabled"]) === 1,
  changedAt: String(r["changed_at"]), changedBy: r["changed_by"] === null ? null : String(r["changed_by"]),
});

export class PluginRepo {
  readonly #db: DatabaseSync;
  constructor(db: DatabaseSync) { this.#db = db; }

  listPlugins(): PluginRow[] {
    return (this.#db.prepare("SELECT * FROM plugin ORDER BY id").all() as Row[]).map(pluginOf);
  }
  findPlugin(id: string): PluginRow | null {
    const r = this.#db.prepare("SELECT * FROM plugin WHERE id = ?").get(id) as Row | undefined;
    return r ? pluginOf(r) : null;
  }
  listPluginVersions(id?: string): PluginVersionRow[] {
    const rows = id === undefined
      ? this.#db.prepare("SELECT * FROM plugin_version ORDER BY id, installed_at DESC").all()
      : this.#db.prepare("SELECT * FROM plugin_version WHERE id = ? ORDER BY installed_at DESC").all(id);
    return (rows as Row[]).map(versionOf);
  }
  findPluginVersion(id: string, version: string): PluginVersionRow | null {
    const r = this.#db.prepare("SELECT * FROM plugin_version WHERE id = ? AND version = ?").get(id, version) as Row | undefined;
    return r ? versionOf(r) : null;
  }
  addPluginVersion(v: Omit<PluginVersionRow, "installedAt">): void {
    this.#db.prepare("INSERT INTO plugin_version (id, version, sha256, manifest_json, signer, size, source, installed_at, installed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(v.id, v.version, v.sha256, JSON.stringify(v.manifest), v.signer, v.size, v.source, now(), v.installedBy);
  }
  /** 지금 쓰는 버전 · 켬/끔 — 없으면 만든다 */
  setPlugin(id: string, patch: { active?: string; enabled?: boolean }, by: string | null): PluginRow {
    const have = this.findPlugin(id);
    if (!have) {
      if (!patch.active) throw new Error(`플러그인 ${id}의 버전이 없습니다`);
      this.#db.prepare("INSERT INTO plugin (id, active, enabled, changed_at, changed_by) VALUES (?, ?, ?, ?, ?)").run(id, patch.active, patch.enabled === false ? 0 : 1, now(), by);
    } else {
      this.#db.prepare("UPDATE plugin SET active = ?, enabled = ?, changed_at = ?, changed_by = ? WHERE id = ?")
        .run(patch.active ?? have.active, (patch.enabled ?? have.enabled) ? 1 : 0, now(), by, id);
    }
    return this.findPlugin(id)!;
  }
  removePlugin(id: string): void {
    this.#db.prepare("DELETE FROM plugin_version WHERE id = ?").run(id);
    this.#db.prepare("DELETE FROM plugin WHERE id = ?").run(id);
  }
  logPlugin(action: string, plugin: string, version: string | null, note: string, by: string | null): void {
    this.#db.prepare("INSERT INTO plugin_event (at, action, plugin, version, note, by_email) VALUES (?, ?, ?, ?, ?, ?)").run(now(), action, plugin, version, note, by);
  }
  pluginEvents(limit = 50): PluginEvent[] {
    return (this.#db.prepare("SELECT * FROM plugin_event ORDER BY id DESC LIMIT ?").all(limit) as Row[]).map((r) => ({
      at: String(r["at"]), action: String(r["action"]), plugin: String(r["plugin"]), version: r["version"] === null ? null : String(r["version"]),
      by: r["by_email"] === null ? null : String(r["by_email"]), note: String(r["note"]),
    }));
  }
  getSetting(key: string): string | null {
    const r = this.#db.prepare("SELECT value FROM app_setting WHERE key = ?").get(key) as Row | undefined;
    return r ? String(r["value"]) : null;
  }
  setSetting(key: string, value: string | null): void {
    if (value === null) this.#db.prepare("DELETE FROM app_setting WHERE key = ?").run(key);
    else this.#db.prepare("INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }
}
