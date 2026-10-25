/**
 * **AI가 다시 쓸 수 있는 요소**(PLAN §42 · 2026-10-25) — 웹페이지 동작의 «어느 요소»는 AI가 지어내지 않는다.
 * 이미 검증된 요소에 짧은 이름(ref)을 붙여 보여 주고, AI는 동작에 `"from": "r3"`만 적는다 → ai/build.ts가 그 요소(위치 후보 · 지문)를 그대로 옮긴다.
 *
 *   같은 사이트의 워크플로우 — 사람이 녹화해 둔 동작(GET /api/ai/site-flows) · r1 …
 *   AI가 본 화면 — 화면 요약의 요소마다(POST /api/ai/browse · 그 요소 하나만 가리키는 위치만) · p1 …
 *
 * ★목록에 없는 ref는 받지 않는다 — 그래서 들어간 위치는 늘 «누군가 실제로 눌러 본 것»이다.
 */
import type { Flow, TableTarget, Target } from "@flowsmith/core";

export interface RefElement {
  ref: string;
  /** 어디서 온 것인가 — «주문 조회 › 주문 읽기» */
  where: string;
  /** 그 요소로 했던 동작 */
  kind: string;
  label: string;
  target?: Target;
  table?: TableTarget;
  /** 읽기면 그때의 출력 이름 · 넣기면 그때의 값(참고) */
  output?: string;
  value?: string;
  /** 화면에 지금 보이는 글자 · 고를 수 있는 것(화면 요약) */
  now?: string;
  options?: string[];
}

/** 화면 요약(서버 recorder/snapshot.ts의 모양) */
export interface PageElement { kind: "button" | "link" | "input" | "select" | "checkbox" | "radio" | "text" | "table"; label: string; text?: string; options?: string[]; target?: Target; table?: TableTarget }
export interface BrowseView { url: string; title: string; elements: PageElement[]; shot?: string }

const ACTION_OF: Record<PageElement["kind"], string> = { button: "click", link: "click", checkbox: "click", radio: "click", input: "fill", select: "select", text: "read", table: "readTable" };

/** 같은 요소인가 — 첫 위치(표면 행 위치)가 같으면 */
const keyOf = (r: { target?: Target; table?: TableTarget }): string => {
  const l = r.table ? r.table.rows.locators[0] : r.target?.locators[0];
  return l ? `${r.table ? "t" : "e"}\0${l.kind}\0${l.value}\0${l.name ?? ""}` : "";
};

/**
 * 본 화면의 요소 → ref 목록. ★이미 본 요소(seen — 같은 첫 위치)면 그 ref를 그대로 쓴다(다시 볼 때마다 번호가 늘지 않게) ·
 * 처음 보는 요소만 새 번호(p{seen 수 + 1} …). 돌려주는 것은 이 화면의 요소 전부(다시 쓴 것 포함)
 */
export function pageRefs(v: BrowseView, seen: RefElement[] = []): RefElement[] {
  const byKey = new Map(seen.map((r) => [keyOf(r), r]));
  let n = seen.length + 1;
  return v.elements.flatMap((e): RefElement[] => {
    if (!e.target && !e.table) return [];
    const old = byKey.get(keyOf(e));
    return [{
      ref: old?.ref ?? `p${n++}`, where: `화면 «${v.title || v.url}»`, kind: ACTION_OF[e.kind], label: e.label,
      ...(e.target ? { target: e.target } : {}), ...(e.table ? { table: e.table } : {}),
      ...(e.text ? { now: e.text } : {}), ...(e.options?.length ? { options: e.options } : {}),
    }];
  });
}

/** 서버가 준 같은 사이트의 워크플로우(웹페이지 노드만) */
export interface SiteFlow {
  id: string;
  name: string;
  nodes: { id: string; name: string; start: unknown; actions: { id: string; kind: string; target?: Target; table?: TableTarget; value?: string; output?: string }[] }[];
}

const hasLocators = (t: Target | undefined): t is Target => !!t && t.locators.some((l) => l.value);

/** 같은 사이트 워크플로우의 녹화된 동작 → ref 목록(r1, r2 …) · 최대 max개 */
export function siteRefs(flows: SiteFlow[], max = 80): RefElement[] {
  const out: RefElement[] = [];
  for (const f of flows) for (const n of f.nodes) for (const a of n.actions) {
    if (out.length >= max) return out;
    const table = a.kind === "readTable" && a.table && hasLocators(a.table.rows) ? a.table : undefined;
    if (!hasLocators(a.target) && !table) continue;
    out.push({
      ref: `r${out.length + 1}`, where: `${f.name} › ${n.name}`, kind: a.kind,
      label: table?.label || a.target?.label || a.kind,
      ...(hasLocators(a.target) ? { target: a.target } : {}), ...(table ? { table } : {}),
      ...(a.output ? { output: a.output } : {}), ...(typeof a.value === "string" && !/\$secrets/.test(a.value) ? { value: a.value } : {}),
    });
  }
  return out;
}

const HOST_RE = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?\b/gi;

/** 사이트 이름(호스트) — 사람이 쓴 글의 주소 · 도메인 + 고치는 초안의 시작 주소(변수는 풀어서) */
export function hostsOf(text: string, draft: Flow | null): string[] {
  const hosts = new Set<string>();
  for (const m of text.matchAll(HOST_RE)) hosts.add(m[1]!.toLowerCase());
  for (const n of draft?.nodes ?? []) {
    if (n.type !== "web" || n.config.start.kind !== "url") continue;
    const url = n.config.start.url.replace(/\{\{\s*\$vars\.([A-Za-z0-9_]+)\s*\}\}/g, (_m, k: string) => draft?.vars[k] ?? "");
    try { hosts.add(new URL(url).hostname.toLowerCase()); } catch { /* 표현식만 있는 주소 */ }
  }
  return [...hosts].filter((h) => !/^(example\.(com|org|net)|flowsmith)$/.test(h)).slice(0, 5);
}

/** 설명서에 보일 목록 — ref · 어디 · 동작 · 이름(위치 자체는 보이지 않는다) */
export function refLines(refs: RefElement[]): string {
  return refs.map((r) => `- ${r.ref} — ${r.where} · ${r.kind} «${r.label}»${r.output ? ` → ${r.output}` : ""}${r.value ? ` = "${r.value.slice(0, 40)}"` : ""}${r.now && r.kind !== "readTable" ? ` (지금 «${r.now.slice(0, 40)}»)` : ""}${r.options ? ` (고를 것: ${r.options.slice(0, 8).join(", ")})` : ""}${r.table ? ` (표 · 열 ${r.table.columns.map((c) => c.name).join(", ")}${r.now ? ` · ${r.now}` : ""})` : ""}`).join("\n");
}
