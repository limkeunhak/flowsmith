/**
 * 줄 ↔ 모양 · 들어온 값 검사 — 저장소들이 함께 쓰는 작은 도우미.
 */
import { ID_RE } from "@flowsmith/core";
import { hashToken, newToken } from "../auth/tokens.ts";
import type { Row } from "./db.ts";
import { StoreError, type ProbeRow, type RunRow, type StatNode, type UserRole, type UserRow } from "./types.ts";

/** 초안에서 id와 이름만은 읽을 수 있어야 한다 — 목록에 띄우고 주소로 쓰기 때문이다 */
export function headOf(draft: unknown): { id: string; name: string } {
  if (draft === null || typeof draft !== "object" || Array.isArray(draft)) throw new StoreError(400, "워크플로우는 객체여야 합니다");
  const { id, name } = draft as Row;
  if (typeof id !== "string" || !ID_RE.test(id)) throw new StoreError(400, `워크플로우 id "${String(id)}"는 영문자로 시작하는 영문 · 숫자 · _ · - 여야 합니다`);
  if (typeof name !== "string" || name.trim() === "") throw new StoreError(400, "워크플로우 이름이 비었습니다");
  return { id, name };
}

/** 같은 내용인지 — 키 순서가 달라도 같게 본다 */
export function canonical(v: unknown): string {
  const sort = (x: unknown): unknown => Array.isArray(x) ? x.map(sort)
    : x !== null && typeof x === "object" ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k, y]) => [k, sort(y)]))
    : x;
  return JSON.stringify(sort(v));
}

/** 실행 결과에서 노드 요약만 — 종류 · 결과 · 시간 · 실패 문장 */
export function nodeSummary(result: unknown): StatNode[] {
  const nodes = (result as { nodes?: { id?: unknown; name?: unknown; type?: unknown; status?: unknown; ms?: unknown; failure?: { message?: unknown } | null }[] } | null)?.nodes;
  return (Array.isArray(nodes) ? nodes : []).map((n) => ({
    id: String(n.id ?? ""), name: String(n.name ?? ""), type: String(n.type ?? ""), status: String(n.status ?? ""),
    ms: typeof n.ms === "number" ? n.ms : 0, failure: n.failure && typeof n.failure.message === "string" ? n.failure.message : null,
  }));
}

export const newWorkerToken = (): string => newToken("fsw_");
export const workerTokenHash = hashToken;

export function workerName(v: unknown): string {
  const n = typeof v === "string" ? v.trim() : "";
  if (!n) throw new StoreError(400, "워커 이름이 비었습니다");
  if (n.length > 60) throw new StoreError(400, "워커 이름은 60자까지입니다");
  return n;
}

/** 라벨 — 띄어쓰기 · 쉼표 없이 40자까지. 쉼표 · 띄어쓰기로 이어 준 글자도 받는다 */
export function labelsOf(v: unknown): string[] {
  const list = typeof v === "string" ? v.split(/[,\s]+/) : Array.isArray(v) ? v : null;
  if (list === null) throw new StoreError(400, "라벨은 목록입니다");
  const out = [...new Set(list.map((x) => String(x).trim()).filter(Boolean))];
  const bad = out.find((x) => x.length > 40 || /[\s,:]/.test(x));
  if (bad) throw new StoreError(400, `라벨 «${bad}» — 띄어쓰기 · 쉼표 · 콜론 없이 40자까지`);
  return out;
}

export function slotsOf(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 20) throw new StoreError(400, "동시 실행 수는 1~20입니다");
  return n;
}

export function toUser(r: Row): UserRow {
  return {
    id: String(r["id"]), email: String(r["email"]), name: String(r["name"]), role: r["role"] as UserRole,
    disabled: Number(r["disabled"]) === 1, mustChange: Number(r["must_change"]) === 1,
    createdAt: String(r["created_at"]), lastLoginAt: (r["last_login_at"] as string | null) ?? null,
  };
}

export function toRun(r: Row): RunRow {
  return {
    id: String(r["id"]),
    flowId: String(r["flow_id"]),
    version: (r["version"] as number | null) ?? null,
    trigger: r["trigger"] as RunRow["trigger"],
    status: r["status"] as RunRow["status"],
    message: String(r["message"]),
    params: JSON.parse(String(r["params_json"])),
    result: r["result_json"] === null ? null : JSON.parse(String(r["result_json"])),
    startedAt: String(r["started_at"]),
    ms: (r["ms"] as number | null) ?? null,
    parentRunId: (r["parent_run_id"] as string | null) ?? null,
    ranOn: (r["ran_on"] as string | null) ?? null,
    startedBy: (r["started_by"] as string | null) ?? null,
    resumedFrom: r["resumed_json"] ? JSON.parse(String(r["resumed_json"])) as RunRow["resumedFrom"] : null,
  };
}

export function toProbe(r: Row): ProbeRow {
  return {
    id: String(r["id"]),
    flowId: String(r["flow_id"]),
    version: (r["version"] as number | null) ?? null,
    source: r["source"] as ProbeRow["source"],
    status: r["status"] as ProbeRow["status"],
    at: String(r["at"]),
    report: r["report_json"] === null ? null : JSON.parse(String(r["report_json"])),
  };
}
