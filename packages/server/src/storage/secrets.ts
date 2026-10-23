/**
 * 플로우의 시크릿 — 넣기 · 목록 · 지우기 · (실행할 때만) 풀기.
 *
 * ★★값이 **밖으로 나가는 길이 없다.** 목록은 «있다/없다»와 저장 시각뿐이다.
 *  풀린 값은 `unlockFor`가 워커에게 건네는 작업 안에만 있다.
 *
 * 팀 공용 값(2026-10-18, storage/shared.ts) — 시크릿 정의에 shared가 켜져 있으면 플로우의 값이 아니라 **제 팀 → 공용** 차례로 찾는다.
 *  플로우의 sharedVars는 같은 차례로 찾아 vars에 더한다(`withShared`). 실행 · 점검 · 녹화 · 알림이 모두 같은 길을 쓴다.
 */
import { NAME_RE, SECRET_PARTS, type SecretDef, type SecretKind, type SecretValue } from "@flowsmith/core";
import type { SharedKind, SharedRow } from "./shared.ts";
import type { SecretBox } from "./secret-box.ts";
import { StoreError, type Store } from "./store.ts";

export interface SecretStatus {
  name: string;
  kind: SecretKind | null;
  description: string;
  stored: boolean;
  updatedAt: string | null;
  /** 저장돼 있는데 초안에는 정의가 없다 — 지워도 되는 값 */
  orphan: boolean;
  /** 팀 공용 값을 쓴다 — stored는 그 값이 있나(어느 범위에서 찾았나: 팀 id · "" 공용) */
  shared: boolean;
  sharedScope: string | null;
}

/** 팀 공용 값의 범위 이름 — "" 공용 */
const sharedAad = (scope: string, name: string): string => `shared/${scope}/${name}`;

const aad = (flowId: string, name: string): string => `${flowId}/${name}`;

/** 초안(틀려 있을 수 있다)에서 시크릿 정의만 너그럽게 꺼낸다 */
export function secretDefsOf(draft: unknown): SecretDef[] {
  const list = (draft as { secrets?: unknown } | null)?.secrets;
  if (!Array.isArray(list)) return [];
  return list.flatMap((s) => {
    const o = s as Partial<SecretDef>;
    return typeof o?.name === "string" && (o.kind === "text" || o.kind === "login")
      ? [{ name: o.name, kind: o.kind, description: typeof o.description === "string" ? o.description : "", shared: o.shared === true }]
      : [];
  });
}

/** 받은 값이 그 종류에 맞나. 맞으면 정리한 값을 돌려준다 */
function validate(kind: SecretKind, value: unknown): SecretValue {
  if (kind === "text") {
    if (typeof value !== "string" || value === "") throw new StoreError(400, "text 시크릿 값은 비어 있지 않은 글자여야 합니다");
    return value;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new StoreError(400, "login 시크릿 값은 { username, password, extra? } 객체여야 합니다");
  const v = value as Record<string, unknown>;
  const extraKeys = Object.keys(v).filter((k) => !SECRET_PARTS.login.includes(k));
  if (extraKeys.length > 0) throw new StoreError(400, `login 시크릿에 모르는 칸이 있습니다: ${extraKeys.join(", ")}`);
  const out: Record<string, string> = {};
  for (const k of SECRET_PARTS.login) {
    const x = v[k];
    if (x === undefined && k === "extra") continue;
    if (typeof x !== "string" || x === "") throw new StoreError(400, `login 시크릿의 ${k}가 비었습니다`);
    out[k] = x;
  }
  return out;
}

export class Secrets {
  private readonly store: Store;
  private readonly box: SecretBox;

  constructor(store: Store, box: SecretBox) {
    this.store = store;
    this.box = box;
  }

  list(flowId: string, draft: unknown): SecretStatus[] {
    const defs = secretDefsOf(draft);
    const stored = new Map(this.store.listSecretNames(flowId).map((s) => [s.name, s.updatedAt]));
    const team = this.store.flowTeam(flowId) ?? null;
    const out: SecretStatus[] = defs.map((d) => {
      if (d.shared) {
        const at = this.#findShared(team, d.name);
        return { name: d.name, kind: d.kind, description: d.description, stored: at !== null && at.kind === d.kind, updatedAt: null, orphan: false, shared: true, sharedScope: at?.scope ?? null };
      }
      return { name: d.name, kind: d.kind, description: d.description, stored: stored.has(d.name), updatedAt: stored.get(d.name) ?? null, orphan: false, shared: false, sharedScope: null };
    });
    for (const [name, updatedAt] of stored) {
      if (!defs.some((d) => d.name === name && !d.shared)) out.push({ name, kind: null, description: "", stored: true, updatedAt, orphan: true, shared: false, sharedScope: null });
    }
    return out;
  }

  /** 팀 공용 시크릿 — 제 팀 → 공용 차례로 */
  #findShared(team: string | null, name: string): { scope: string; sealed: string; kind: SecretKind } | null {
    for (const scope of team ? [team, ""] : [""]) {
      const s = this.store.sealedShared(scope, name);
      if (s) return { scope, ...s };
    }
    return null;
  }

  /** 팀 공용 변수 — 제 팀 → 공용 차례로. 없으면 null */
  sharedVarFor(flowId: string, name: string): string | null {
    const team = this.store.flowTeam(flowId) ?? null;
    for (const scope of team ? [team, ""] : [""]) {
      const v = this.store.sharedVar(scope, name);
      if (v !== null) return v;
    }
    return null;
  }

  /**
   * 플로우에 팀 공용 변수를 더한다(vars에) — 실행 · 점검 · 녹화 · 알림이 쓴다. 찾지 못한 이름은 missing.
   * ★플로우 변수와 같은 이름은 검문소가 막는다(graph.ts) — 그래도 겹치면 플로우 것이 이긴다
   */
  withShared<F extends { vars?: Record<string, string>; sharedVars?: readonly string[] }>(flowId: string, flow: F): { flow: F; missing: string[] } {
    const names = Array.isArray(flow.sharedVars) ? flow.sharedVars.filter((n): n is string => typeof n === "string") : [];
    if (names.length === 0) return { flow, missing: [] };
    const add: Record<string, string> = {};
    const missing: string[] = [];
    for (const n of names) {
      const v = this.sharedVarFor(flowId, n);
      if (v === null) missing.push(n); else add[n] = v;
    }
    // 찾은 값은 vars로 옮겼다 — sharedVars는 비운다(엔진의 검문소가 «vars와 겹침»으로 막지 않게)
    return { flow: { ...flow, vars: { ...add, ...(flow.vars ?? {}) }, sharedVars: [] }, missing };
  }

  /** 팀 공용 값 넣기(관리자) — 변수는 그대로 · 시크릿은 잠근다 */
  putShared(scope: string, kind: SharedKind, name: string, body: { kind?: unknown; value?: unknown; description?: unknown }, by: string | null): string {
    if (!NAME_RE.test(name)) throw new StoreError(400, `이름 "${name}"는 글자 · 숫자 · _ 만 쓸 수 있습니다`);
    const description = typeof body.description === "string" ? body.description : "";
    if (kind === "var") {
      if (typeof body.value !== "string") throw new StoreError(400, "변수 값은 글자여야 합니다(비어도 됩니다)");
      return this.store.putShared({ scope, kind, name, secretKind: null, description, value: body.value, by });
    }
    const secretKind = body.kind;
    if (secretKind !== "text" && secretKind !== "login") throw new StoreError(400, "시크릿 종류(kind)는 text · login 중 하나입니다");
    const clean = validate(secretKind, body.value);
    return this.store.putShared({ scope, kind, name, secretKind, description, value: this.box.seal(JSON.stringify(clean), sharedAad(scope, name)), by });
  }

  /** 팀 공용 값 목록 — ★시크릿 값은 없다(있다/없다 · 종류 · 설명만) */
  listShared(scopes: readonly string[] | null): SharedRow[] {
    return this.store.listShared(scopes);
  }

  /** 넣는다 — 초안에 정의된 이름 · 종류여야 한다 */
  put(flowId: string, draft: unknown, name: string, value: unknown): string {
    if (!NAME_RE.test(name)) throw new StoreError(400, `시크릿 이름 "${name}"는 글자 · 숫자 · _ 만 쓸 수 있습니다`);
    const def = secretDefsOf(draft).find((d) => d.name === name);
    if (!def) throw new StoreError(400, `워크플로우에 시크릿 "${name}"가 정의되어 있지 않습니다 — 먼저 워크플로우의 secrets에 이름과 종류를 적으세요`);
    if (def.shared) throw new StoreError(400, `시크릿 "${name}"는 팀 공용 값을 씁니다 — 관리자가 팀 화면에서 넣습니다`);
    const clean = validate(def.kind, value);
    return this.store.putSealed(flowId, name, this.box.seal(JSON.stringify(clean), aad(flowId, name)));
  }

  delete(flowId: string, name: string): boolean {
    return this.store.deleteSecret(flowId, name);
  }

  /**
   * 실행할 때만 — 플로우가 정의한 시크릿을 푼다. 저장 안 된 것은 빠진다
   * (빠진 것은 엔진의 `checkRunInputs`가 «저장되지 않았습니다»로 잡는다).
   */
  unlockFor(flowId: string, defs: readonly SecretDef[]): Record<string, SecretValue> {
    const sealed = this.store.sealedSecrets(flowId);
    const team = this.store.flowTeam(flowId) ?? null;
    const out: Record<string, SecretValue> = {};
    for (const d of defs) {
      if (d.shared === true) {
        // 팀 공용 — 종류가 다르면 없는 것으로(엔진이 «저장되지 않았습니다»로 잡는다)
        const at = this.#findShared(team, d.name);
        if (at && at.kind === d.kind) out[d.name] = JSON.parse(this.box.open(at.sealed, sharedAad(at.scope, d.name))) as SecretValue;
        continue;
      }
      const s = sealed.get(d.name);
      if (s !== undefined) out[d.name] = JSON.parse(this.box.open(s, aad(flowId, d.name))) as SecretValue;
    }
    return out;
  }
}
