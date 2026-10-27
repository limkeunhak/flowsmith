/**
 * **화면 규칙 — area** — 워크플로우가 어느 화면(사이트의 한 부분)을 다루는지 주소로 알아낸다. 목록은 이 이름으로 묶는다.
 *
 *   규칙   «qa.msu.io/navigator → Navigator» — 주소 앞부분(스킴 없이)과 이름. ★가장 긴 앞부분이 이긴다
 *          («qa.msu.io → MSU 웹»과 함께 두면 /navigator만 Navigator, /notices는 MSU 웹)
 *   주소   초안에서 읽는다 — 첫 웹 노드의 시작 주소(또는 첫 HTTP 노드의 주소)가 먼저, 없으면({{ }}로 만든 주소 · 앞 화면 이어 받기)
 *          초안에 적힌 주소들 중 규칙에 가장 길게 맞는 것. «https://qa.msu.io{{ $params.path }}»는 {{ 앞까지만 본다
 *   이름   규칙에 맞으면 규칙의 이름 · 아니면 그 주소의 호스트(«qa.msu.io») · 주소가 없으면 null(화면 모름)
 *
 * 사람이 워크플로우마다 적지 않는다 — 규칙을 한 번 두면 새 워크플로우도 제자리에 들어간다. 틀린 것만 flow.group_name으로 직접 지정한다.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Row } from "./db.ts";
import { StoreError } from "./types.ts";

export interface AreaRule {
  /** 주소 앞부분 — «qa.msu.io/navigator» */
  prefix: string;
  name: string;
}

/** 초안에서 읽은 주소들 — 시작 주소 · 적힌 주소들(sitePath로 다듬은 것) */
export interface SiteFacts {
  start: string | null;
  urls: string[];
}

/** 주소를 «호스트/경로»로 — 스킴 · 물음표 뒤 · 끝의 / 를 뗀다. {{ }}로 만든 부분은 그 앞까지. scheme이면 http(s)://로 시작해야 */
export function sitePath(raw: string, scheme = true): string | null {
  const head = raw.split("{{")[0]!.trim();
  const m = (scheme ? /^https?:\/\/([^/?#\s]+)([^?#\s]*)/i : /^(?:https?:\/\/)?([^/?#\s]+)([^?#\s]*)/i).exec(head);
  if (!m) return null;
  return m[1]!.toLowerCase() + m[2]!.replace(/\/+$/, "");
}

const URL_RE = /https?:\/\/[^\s"'`\\{}<>]+/g;

/** 초안의 주소들 — 노드 차례로 첫 웹(시작 주소) · HTTP(주소)가 시작, 나머지는 초안 어디에 적혀 있든 */
export function siteFacts(draft: { nodes?: { type?: unknown; config?: unknown }[] }): SiteFacts {
  let start: string | null = null;
  for (const n of Array.isArray(draft.nodes) ? draft.nodes : []) {
    const c = (n?.config ?? {}) as { start?: { kind?: unknown; url?: unknown }; url?: unknown };
    const raw = n?.type === "web" ? (c.start?.kind === "url" ? c.start.url : undefined) : n?.type === "http" ? c.url : undefined;
    if (raw === undefined) continue;
    start = typeof raw === "string" ? sitePath(raw) : null;
    break;
  }
  const urls = [...new Set((JSON.stringify(draft).match(URL_RE) ?? []).flatMap((u) => sitePath(u) ?? []))].slice(0, 50);
  return { start, urls };
}

const fits = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + "/");
/** 가장 긴 규칙 */
function ruleFor(path: string, rules: readonly AreaRule[]): AreaRule | null {
  let best: AreaRule | null = null;
  for (const r of rules) if (fits(path, r.prefix) && (!best || r.prefix.length > best.prefix.length)) best = r;
  return best;
}

/** 이 워크플로우의 화면 — area: 이름(규칙 · 아니면 호스트) · site: 그렇게 본 주소 */
export function areaOf(f: SiteFacts, rules: readonly AreaRule[]): { area: string | null; site: string | null } {
  if (f.start) {
    const r = ruleFor(f.start, rules);
    if (r) return { area: r.name, site: f.start };
  }
  let best: { r: AreaRule; u: string } | null = null;
  for (const u of f.urls) { const r = ruleFor(u, rules); if (r && (!best || r.prefix.length > best.r.prefix.length)) best = { r, u }; }
  if (best) return { area: best.r.name, site: best.u };
  // 규칙에 안 맞는다 — 호스트로. 시작 주소가 없으면 가장 깊은 주소(앞 화면에서 넘겨받는 것은 뒤에서 그 화면 주소를 적는다)
  const site = f.start ?? [...f.urls].sort((a, b) => b.split("/").length - a.split("/").length)[0] ?? null;
  return { area: site ? site.split("/")[0]! : null, site };
}

export class AreaRepo {
  readonly #db: DatabaseSync;
  constructor(db: DatabaseSync) { this.#db = db; }

  /** 규칙들 — 앞부분 차례 */
  listAreas(): AreaRule[] {
    return (this.#db.prepare("SELECT prefix, name FROM area ORDER BY prefix").all() as Row[]).map((r) => ({ prefix: String(r["prefix"]), name: String(r["name"]) }));
  }

  /** 통째로 바꾼다 — 하나라도 틀리면 아무것도 바꾸지 않는다 */
  setAreas(v: unknown): AreaRule[] {
    if (!Array.isArray(v)) throw new StoreError(400, "areas는 [{ prefix, name }] 목록입니다");
    if (v.length > 200) throw new StoreError(400, "화면 규칙은 200개까지입니다");
    const rules = v.map((x: { prefix?: unknown; name?: unknown }, i): AreaRule => {
      const prefix = typeof x?.prefix === "string" ? sitePath(x.prefix, false) : null;
      if (!prefix || prefix.length > 200) throw new StoreError(400, `${i + 1}번째 규칙 — 주소 앞부분을 «qa.msu.io/navigator»처럼 적으세요`);
      const name = groupName(x?.name);
      if (!name) throw new StoreError(400, `${i + 1}번째 규칙 — 화면 이름이 필요합니다`);
      return { prefix, name };
    });
    const dup = rules.find((r, i) => rules.findIndex((o) => o.prefix === r.prefix) !== i);
    if (dup) throw new StoreError(400, `주소 앞부분 «${dup.prefix}»가 두 번 있습니다`);
    this.#db.exec("BEGIN");
    try {
      this.#db.exec("DELETE FROM area");
      const put = this.#db.prepare("INSERT INTO area (prefix, name) VALUES (?, ?)");
      for (const r of rules) put.run(r.prefix, r.name);
      this.#db.exec("COMMIT");
    } catch (e) { this.#db.exec("ROLLBACK"); throw e; }
    return this.listAreas();
  }
}

/** 화면 · 묶음 이름 — 앞뒤 빈칸을 떼고 · 빈 것은 null · 한 줄 · 40자까지(직접 지정한 화면도 같은 규칙) */
export function groupName(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new StoreError(400, "화면 이름은 글자 또는 null입니다");
  const g = v.trim();
  if (g === "") return null;
  if (/[\r\n]/.test(g)) throw new StoreError(400, "화면 이름은 한 줄이어야 합니다");
  if (g.length > 40) throw new StoreError(400, "화면 이름은 40자까지입니다");
  return g;
}
