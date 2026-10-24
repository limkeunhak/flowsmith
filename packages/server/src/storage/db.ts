/**
 * SQLite를 연다 — 스키마 · 옛 DB 고치기(마이그레이션) · 트랜잭션. 저장소들(flows · history · people · workers)이 함께 쓴다.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PLUGIN_SCHEMA } from "./plugins.ts";
import { AI_SCHEMA } from "./ai.ts";

export type Row = Record<string, unknown>;
export const now = (): string => new Date().toISOString();

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS flow (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  draft_json      TEXT NOT NULL,
  active_version  INTEGER,
  -- 서버가 붙이는 바뀌지 않는 이름 — 저장 노드의 폴더(files/<uid>). 매니페스트(JSON)에는 없다
  uid             TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS flow_version (
  flow_id         TEXT NOT NULL REFERENCES flow(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  manifest_json   TEXT NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  PRIMARY KEY (flow_id, version)
);
CREATE TABLE IF NOT EXISTS secret (
  flow_id         TEXT NOT NULL REFERENCES flow(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  sealed          TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (flow_id, name)
);
CREATE TABLE IF NOT EXISTS run (
  id              TEXT PRIMARY KEY,
  flow_id         TEXT NOT NULL REFERENCES flow(id) ON DELETE CASCADE,
  version         INTEGER,            -- NULL = 초안으로 돌린 시험 실행
  trigger         TEXT NOT NULL,      -- manual | api | schedule | webhook | flow
  parent_run_id   TEXT,               -- 다른 워크플로우 실행 노드가 부른 실행이면 부른 실행
  status          TEXT NOT NULL,      -- running | success | failure | cancelled(사람이 멈춤)
  message         TEXT NOT NULL DEFAULT '',
  params_json     TEXT NOT NULL,
  result_json     TEXT,
  started_at      TEXT NOT NULL,
  ms              INTEGER
);
CREATE INDEX IF NOT EXISTS run_by_flow ON run(flow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS run_by_time ON run(started_at);   -- 대시보드 · 기록 정리
CREATE TABLE IF NOT EXISTS probe (
  id              TEXT PRIMARY KEY,
  flow_id         TEXT NOT NULL REFERENCES flow(id) ON DELETE CASCADE,
  version         INTEGER,            -- NULL = 초안
  source          TEXT NOT NULL,      -- probe(점검 실행) | run(실제 실행이 깨진 것을 발견)
  status          TEXT NOT NULL,      -- running | ok | changed | broken | error
  at              TEXT NOT NULL,
  report_json     TEXT
);
CREATE INDEX IF NOT EXISTS probe_by_flow ON probe(flow_id, at DESC);
CREATE TABLE IF NOT EXISTS webhook (
  flow_id         TEXT PRIMARY KEY REFERENCES flow(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL,      -- ★토큰은 해시만 둔다. 토큰 자체는 만들 때 한 번만 보인다
  created_at      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schedule_fire (
  flow_id         TEXT NOT NULL REFERENCES flow(id) ON DELETE CASCADE,
  schedule_id     TEXT NOT NULL,
  minute          TEXT NOT NULL,      -- 2026-10-16T09:00 — 같은 분에 두 번 돌지 않게
  at              TEXT NOT NULL,
  PRIMARY KEY (flow_id, schedule_id, minute)
);
CREATE TABLE IF NOT EXISTS notice (
  id              TEXT PRIMARY KEY,
  flow_id         TEXT NOT NULL REFERENCES flow(id) ON DELETE CASCADE,
  rule_id         TEXT NOT NULL,
  event           TEXT NOT NULL,      -- failure | recovered | success | cancelled | drift | test
  channel         TEXT NOT NULL,      -- slack | teams | webhook
  ref_id          TEXT,               -- 실행 id · 점검 id (시험이면 NULL)
  ok              INTEGER NOT NULL,
  status          INTEGER,            -- 받은 HTTP 상태 — 연결도 못 했으면 NULL
  error           TEXT NOT NULL DEFAULT '',
  at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notice_by_flow ON notice(flow_id, at DESC);
CREATE TABLE IF NOT EXISTS app_user (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,   -- 소문자로
  name            TEXT NOT NULL,
  role            TEXT NOT NULL,          -- admin | editor | runner | viewer
  pw_hash         TEXT NOT NULL,          -- scrypt$N$r$p$salt$hash
  disabled        INTEGER NOT NULL DEFAULT 0,
  must_change     INTEGER NOT NULL DEFAULT 0,  -- 관리자가 정해 준 임시 비밀번호 — 처음 들어오면 바꾼다
  created_at      TEXT NOT NULL,
  last_login_at   TEXT
);
CREATE TABLE IF NOT EXISTS team (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS team_member (
  team_id         TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE IF NOT EXISTS worker (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  labels_json     TEXT NOT NULL DEFAULT '[]',
  slots           INTEGER NOT NULL DEFAULT 1,     -- 동시에 도는 실행 수(젠킨스의 executor)
  team_id         TEXT REFERENCES team(id),       -- 이 팀 · 공용 워크플로우만 돈다. NULL이면 모든 팀
  enabled         INTEGER NOT NULL DEFAULT 1,     -- 0 = 잠시 끔(새 일을 받지 않는다)
  token_hash      TEXT NOT NULL,                  -- ★토큰은 해시만. 토큰 자체는 만들 때 한 번만 보인다
  created_at      TEXT NOT NULL,
  last_seen_at    TEXT,
  info_json       TEXT,                           -- 마지막으로 붙었을 때 — PC 이름 · node 버전 · 확장
  kind            TEXT NOT NULL DEFAULT 'shared', -- shared = 공용 워커(누구의 실행이든) · personal = 개인 워커(주인이 «내 PC에서»로 돌린 실행만)
  owner           TEXT                            -- 개인 워커의 주인(메일)
);
CREATE TABLE IF NOT EXISTS session (
  token_hash      TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_token (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,                  -- 어디에 쓰나(사람이 붙인 이름)
  role            TEXT NOT NULL,                  -- 만든 사람의 역할 이하 — 쓸 때 그 사람의 지금 역할과 견주어 낮은 쪽
  token_hash      TEXT NOT NULL UNIQUE,           -- ★토큰은 해시만. 토큰 자체는 만들 때 한 번만 보인다
  created_at      TEXT NOT NULL,
  last_used_at    TEXT,
  expires_at      TEXT                            -- NULL이면 끝나지 않는다
);
CREATE INDEX IF NOT EXISTS api_token_by_user ON api_token(user_id);
CREATE TABLE IF NOT EXISTS suite (              -- 웹 e2e 테스트 묶음(storage/suites.ts) — 팀마다 여러 개 · 시나리오 · 일정 · 알림(JSON)
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  team_id         TEXT REFERENCES team(id),
  items_json      TEXT NOT NULL DEFAULT '[]',
  schedules_json  TEXT NOT NULL DEFAULT '[]',
  notify_json     TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT
);
CREATE TABLE IF NOT EXISTS suite_run (          -- Suite 한 번 — 시나리오마다의 판정(items_json)
  id              TEXT PRIMARY KEY,
  suite_id        TEXT NOT NULL REFERENCES suite(id) ON DELETE CASCADE,
  status          TEXT NOT NULL,                  -- running | pass | fail | error | cancelled
  trigger         TEXT NOT NULL,                  -- manual | schedule | api
  only_item       TEXT,                           -- 단건 실행이면 그 시나리오 id
  started_by      TEXT,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  ms              INTEGER,
  items_json      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS suite_run_by_suite ON suite_run(suite_id, started_at DESC);
CREATE TABLE IF NOT EXISTS suite_fire (
  suite_id        TEXT NOT NULL REFERENCES suite(id) ON DELETE CASCADE,
  schedule_id     TEXT NOT NULL,
  minute          TEXT NOT NULL,
  at              TEXT NOT NULL,
  PRIMARY KEY (suite_id, schedule_id, minute)
);
CREATE TABLE IF NOT EXISTS run_shot (           -- 검사가 불통과였을 때의 페이지 한 장(실행마다 하나) — 실행이 지워지면 함께
  run_id          TEXT PRIMARY KEY REFERENCES run(id) ON DELETE CASCADE,
  node_id         TEXT NOT NULL,
  mime            TEXT NOT NULL,
  data            BLOB NOT NULL,
  at              TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shared_value (       -- 팀 공용 값(storage/shared.ts) — scope는 팀 id · ""(공용). 시크릿 값은 잠겨 있다
  scope           TEXT NOT NULL,
  kind            TEXT NOT NULL,                  -- var | secret
  name            TEXT NOT NULL,
  secret_kind     TEXT,                           -- text | login(시크릿만)
  description     TEXT NOT NULL DEFAULT '',
  value           TEXT NOT NULL,                  -- 변수는 그대로 · 시크릿은 SecretBox로 잠근 것
  updated_at      TEXT NOT NULL,
  updated_by      TEXT,
  PRIMARY KEY (scope, kind, name)
);
CREATE TABLE IF NOT EXISTS file_trigger (       -- 파일이 생기면 — 트리거마다 «무엇을 볼 때 시작했나»(폴더 · 꼴). 바뀌면 다시 시작
  flow_id         TEXT NOT NULL,
  trigger_id      TEXT NOT NULL,
  signature       TEXT NOT NULL,
  PRIMARY KEY (flow_id, trigger_id)
);
CREATE TABLE IF NOT EXISTS file_seen (          -- 이미 본 파일 — 같은 파일로 두 번 돌지 않게(서버를 다시 켜도)
  flow_id         TEXT NOT NULL,
  trigger_id      TEXT NOT NULL,
  name            TEXT NOT NULL,
  at              TEXT NOT NULL,
  PRIMARY KEY (flow_id, trigger_id, name)
);
`;

/** `:memory:`도 된다(시험) */
export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  db.exec(PLUGIN_SCHEMA);
  db.exec(AI_SCHEMA);
  migrate(db);
  return db;
}

/** 옛 DB — 없는 칸을 더하고, 빈 것을 채운다 */
function migrate(db: DatabaseSync): void {
  const cols = (db.prepare("PRAGMA table_info(flow)").all() as Row[]).map((c) => String(c["name"]));
  if (!cols.includes("uid")) db.exec("ALTER TABLE flow ADD COLUMN uid TEXT");
  const runCols = (db.prepare("PRAGMA table_info(run)").all() as Row[]).map((c) => String(c["name"]));
  if (!runCols.includes("parent_run_id")) db.exec("ALTER TABLE run ADD COLUMN parent_run_id TEXT");
  // 누가 — 사내 서버형(2026-10-17)
  if (!runCols.includes("started_by")) db.exec("ALTER TABLE run ADD COLUMN started_by TEXT");
  if (!cols.includes("updated_by")) db.exec("ALTER TABLE flow ADD COLUMN updated_by TEXT");
  // 팀 — 없으면 «공용»(2026-10-17)
  if (!cols.includes("team_id")) db.exec("ALTER TABLE flow ADD COLUMN team_id TEXT");
  // 워커 — 어디서 도나 · 어디서 돌았나(2026-10-17)
  if (!cols.includes("run_on")) db.exec("ALTER TABLE flow ADD COLUMN run_on TEXT");
  // 게시 — 언제 · 누가(감사 기록 · 밖에서 받아 가는 게시본, 2026-10-17). 옛 기록은 비어 있다
  if (!cols.includes("deployed_at")) db.exec("ALTER TABLE flow ADD COLUMN deployed_at TEXT");
  // 고정된 출력(pin data, 2026-10-18) — 초안과 따로 둔다: 버전에 들어가지 않고(버전 = 초안 원문), 초안 시험에서만 쓴다
  if (!cols.includes("pins_json")) db.exec("ALTER TABLE flow ADD COLUMN pins_json TEXT");
  if (!cols.includes("deployed_by")) db.exec("ALTER TABLE flow ADD COLUMN deployed_by TEXT");
  if (!runCols.includes("ran_on")) db.exec("ALTER TABLE run ADD COLUMN ran_on TEXT");
  // 대시보드 — 노드 요약(결과 본문을 다시 읽지 않게, 2026-10-17). 옛 기록은 비어 있고 runsSince가 결과에서 만든다
  if (!runCols.includes("nodes_json")) db.exec("ALTER TABLE run ADD COLUMN nodes_json TEXT");
  // 워커 종류(2026-10-24, PLAN §44 · 4단계) — 옛 워커는 모두 공용
  const workerCols = (db.prepare("PRAGMA table_info(worker)").all() as Row[]).map((c) => String(c["name"]));
  if (!workerCols.includes("kind")) db.exec("ALTER TABLE worker ADD COLUMN kind TEXT NOT NULL DEFAULT 'shared'");
  if (!workerCols.includes("owner")) db.exec("ALTER TABLE worker ADD COLUMN owner TEXT");
  const verCols = (db.prepare("PRAGMA table_info(flow_version)").all() as Row[]).map((c) => String(c["name"]));
  if (!verCols.includes("created_by")) db.exec("ALTER TABLE flow_version ADD COLUMN created_by TEXT");
  // 확장 플러그인(2026-10-20) — 버전을 만들 때 쓴 플러그인 버전(id → 버전). 옛 버전은 비어 있다
  if (!verCols.includes("plugins_json")) db.exec("ALTER TABLE flow_version ADD COLUMN plugins_json TEXT");
  for (const r of db.prepare("SELECT id FROM flow WHERE uid IS NULL").all() as Row[]) {
    db.prepare("UPDATE flow SET uid = ? WHERE id = ?").run(randomUUID(), String(r["id"]));
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS flow_uid ON flow(uid)");
}

export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
}
