/**
 * AI 기록(run/ai.ts) — 누가 · 언제 · 어느 워크플로우에서 · 얼마나(토큰). ★주고받은 글은 남기지 않는다(초안 · 지시에 업무 내용이 든다).
 * 설정(모델 · 켬 · 잠근 키)은 app_setting에 — 키는 시크릿 상자로 잠근다.
 */
import type { DatabaseSync } from "node:sqlite";

type Row = Record<string, unknown>;

export const AI_SCHEMA = `
CREATE TABLE IF NOT EXISTS ai_call (              -- AI 부르기 한 번(run/ai.ts) — 글은 남기지 않고 누가 · 얼마나만
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  at              TEXT NOT NULL,
  by_email        TEXT,
  flow_id         TEXT,
  model           TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  ok              INTEGER NOT NULL,
  error           TEXT
);
CREATE INDEX IF NOT EXISTS ai_call_by_at ON ai_call (by_email, at);
`;

export interface AiCallRow { at: string; by: string | null; flowId: string | null; model: string; inputTokens: number; outputTokens: number; ok: boolean; error: string | null }

export class AiRepo {
  readonly #db: DatabaseSync;
  constructor(db: DatabaseSync) { this.#db = db; }

  logAiCall(c: Omit<AiCallRow, "at">): void {
    this.#db.prepare("INSERT INTO ai_call (at, by_email, flow_id, model, input_tokens, output_tokens, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(new Date().toISOString(), c.by, c.flowId, c.model, c.inputTokens, c.outputTokens, c.ok ? 1 : 0, c.error);
  }

  /** 최근 n분 동안 이 사람이 부른 수 — 너무 잦으면 막는다 */
  aiCallsSince(by: string | null, sinceIso: string): number {
    const r = (by === null
      ? this.#db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE by_email IS NULL AND at >= ?").get(sinceIso)
      : this.#db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE by_email = ? AND at >= ?").get(by, sinceIso)) as Row;
    return Number(r["n"]);
  }

  /** 날마다 쓴 양 — 관리 화면 */
  aiUsage(days = 30): { day: string; calls: number; inputTokens: number; outputTokens: number }[] {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    return (this.#db.prepare("SELECT substr(at, 1, 10) AS day, COUNT(*) AS calls, SUM(input_tokens) AS i, SUM(output_tokens) AS o FROM ai_call WHERE at >= ? GROUP BY day ORDER BY day DESC").all(since) as Row[])
      .map((r) => ({ day: String(r["day"]), calls: Number(r["calls"]), inputTokens: Number(r["i"] ?? 0), outputTokens: Number(r["o"] ?? 0) }));
  }
}
