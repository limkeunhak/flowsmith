/**
 * 표현식 — **치환만** 한다 (PLAN §3.3).
 *
 *   {{ $input.orderNo }}  {{ $node.login.userName }}  {{ $params.orderNo }}
 *   {{ $input }}        — 앞 단계가 준 것 전부(객체 하나 — 파일 쓰기에 읽은 값을 한 행으로)
 *   {{ $vars.baseUrl }}  {{ $secrets.portal.password }}
 *   {{ $item.주문번호 }}  — «다른 플로우 실행»이 행마다 돌 때 그 행(그 자리에서만)
 *
 * ★연산 · 함수 호출 · 조건식은 없다 —
 *  표현식이 DSL로 자라면 검문소가 그 언어를 다 이해해야 한다. 로직은 커스텀 노드로 간다.
 */

export const EXPR_ROOTS = ["$input", "$node", "$params", "$vars", "$secrets", "$item"] as const;
export type ExprRoot = (typeof EXPR_ROOTS)[number];

export interface Ref {
  root: ExprRoot;
  path: string[];
  /** 원문 — 오류 메시지용 */
  raw: string;
}

export type Segment = { kind: "text"; text: string } | { kind: "ref"; ref: Ref };

/** 이름 한 마디 — 점 · 공백 · 중괄호 · 대괄호만 아니면 된다(한글 이름을 쓴다) */
const NAME_RE = /^[^\s.{}[\]]+$/u;
const EXPR_RE = /\{\{([\s\S]*?)\}\}/g;

export class ExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExprError";
  }
}

/** 루트마다 뒤에 붙어야 하는 마디 수 [최소, 최대] */
const ARITY: Record<ExprRoot, [number, number]> = {
  $input: [0, Infinity],
  $node: [2, Infinity],
  $params: [1, 1],
  $vars: [1, 1],
  $secrets: [1, 2],
  $item: [0, Infinity],
};

function parseRef(inner: string): Ref {
  const raw = inner.trim();
  if (raw === "") throw new ExprError("{{ }} 안이 비었습니다");
  const parts = raw.split(".");
  const root = parts[0] as ExprRoot;
  if (!(EXPR_ROOTS as readonly string[]).includes(root)) {
    throw new ExprError(`"${raw}": ${EXPR_ROOTS.join(" · ")} 중 하나로 시작해야 합니다 (치환만 됩니다 — 계산은 커스텀 노드에서)`);
  }
  const path = parts.slice(1);
  for (const p of path) {
    if (!NAME_RE.test(p)) throw new ExprError(`"${raw}": 이름 "${p}"를 읽을 수 없습니다 (공백 · 괄호 · 연산자는 못 씁니다)`);
  }
  const [min, max] = ARITY[root];
  if (path.length < min || path.length > max) {
    const want = min === max ? `${min}` : max === Infinity ? `${min}개 이상` : `${min}~${max}`;
    throw new ExprError(`"${raw}": ${root} 뒤에는 이름이 ${want} 와야 합니다`);
  }
  return { root, path, raw };
}

/** 템플릿을 글자와 참조로 쪼갠다. 문법이 틀리면 던진다. */
export function parseTemplate(template: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of template.matchAll(EXPR_RE)) {
    const at = m.index;
    if (at > last) out.push({ kind: "text", text: template.slice(last, at) });
    out.push({ kind: "ref", ref: parseRef(m[1] ?? "") });
    last = at + m[0].length;
  }
  const rest = template.slice(last);
  if (rest.includes("{{") || rest.includes("}}")) throw new ExprError(`짝이 안 맞는 {{ }}가 있습니다: "${template}"`);
  if (rest !== "") out.push({ kind: "text", text: rest });
  return out;
}

/** 참조 하나뿐인 템플릿인가 — 「{{ $input.rows }}」(앞뒤 공백은 본다). 그 값이 글자가 아니라 값 그대로 쓰인다 */
export function isSingleRefTemplate(template: string): boolean {
  try {
    const segs = parseTemplate(template.trim());
    return segs.length === 1 && segs[0]!.kind === "ref";
  } catch { return false; }
}

/** 템플릿이 쓰는 참조들. 문법이 틀리면 던진다. */
export function refsOf(template: string): Ref[] {
  return parseTemplate(template).flatMap((s) => (s.kind === "ref" ? [s.ref] : []));
}

// ─── 값 채우기 ─────────────────────────────────────────────────────

export type SecretValue = string | Record<string, string>;

export interface Scope {
  input: Record<string, unknown>;
  nodes: Record<string, Record<string, unknown>>;
  params: Record<string, unknown>;
  vars: Record<string, string>;
  /** 이 실행에서 쓸 수 있는 시크릿. 시크릿을 받으면 안 되는 자리면 비워 둔다 */
  secrets: Record<string, SecretValue>;
  /** 행마다 돌 때의 그 행 — «다른 플로우 실행»의 실행 입력 값에서만 */
  item?: unknown;
}

export interface Evaluated {
  /** 템플릿이 참조 하나뿐이면 그 값 그대로(객체 · 숫자 · undefined), 아니면 문자열 */
  value: unknown;
  /** 쓰인 시크릿 값들 — 실행기가 로그 · 결과에서 가린다 */
  secretsUsed: string[];
}

function dig(v: unknown, path: readonly string[]): unknown {
  let cur = v;
  for (const p of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function lookup(ref: Ref, scope: Scope, secretsUsed: string[]): unknown {
  switch (ref.root) {
    case "$input": return dig(scope.input, ref.path);
    case "$node": return dig(scope.nodes[ref.path[0]!], ref.path.slice(1));
    case "$params": return scope.params[ref.path[0]!];
    case "$vars": return scope.vars[ref.path[0]!];
    case "$item": return dig(scope.item, ref.path);
    case "$secrets": {
      const s = scope.secrets[ref.path[0]!];
      if (s === undefined) throw new ExprError(`"${ref.raw}": 이 자리에서는 시크릿을 쓸 수 없거나, 값이 저장되지 않았습니다`);
      const part = ref.path[1];
      const v = typeof s === "string" ? (part === undefined ? s : undefined) : (part === undefined ? undefined : s[part]);
      if (v === undefined) throw new ExprError(`"${ref.raw}": 시크릿에 그 칸이 없습니다`);
      secretsUsed.push(v);
      return v;
    }
  }
}

const show = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/**
 * 템플릿을 채운다.
 * ★글자 사이에 끼운 참조가 비어 있으면 던진다 — 빈 칸을 조용히 넣으면 «비어 있지 않은데 틀린 값»이 된다.
 *  참조 하나뿐인 템플릿은 undefined를 그대로 돌려준다(조건 노드의 `empty`가 써야 한다).
 */
export function evaluate(template: string, scope: Scope): Evaluated {
  const segs = parseTemplate(template);
  const secretsUsed: string[] = [];
  if (segs.length === 1 && segs[0]!.kind === "ref") {
    return { value: lookup(segs[0]!.ref, scope, secretsUsed), secretsUsed };
  }
  let s = "";
  for (const seg of segs) {
    if (seg.kind === "text") { s += seg.text; continue; }
    const v = lookup(seg.ref, scope, secretsUsed);
    if (v === undefined) throw new ExprError(`"${seg.ref.raw}" 값이 없습니다`);
    s += show(v);
  }
  return { value: s, secretsUsed };
}

// ─── 가리기 ────────────────────────────────────────────────────────

export const MASK = "***";

/**
 * 시크릿 값을 가린다 — 문자열이면 안의 값을, 객체 · 배열이면 끝까지 들어가서.
 * ★긴 값부터 바꾼다: "abc"와 "abcdef"가 둘 다 시크릿이면 짧은 걸 먼저 바꾸면 "***def"가 남는다.
 */
export function redact<T>(value: T, secrets: readonly string[]): T {
  const list = [...new Set(secrets)].filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
  if (list.length === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return list.reduce((acc, s) => acc.split(s).join(MASK), v);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
