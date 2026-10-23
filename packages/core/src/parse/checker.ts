/**
 * 검문소의 도구 — 문제를 모으면서 읽는 Checker · 오류 · 이름 규칙. 노드마다의 읽기(web · condition · nodes)가 쓴다.
 */
export class FlowError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`워크플로우에 문제가 ${problems.length}개 있습니다:\n- ${problems.join("\n- ")}`);
    this.name = "FlowError";
    this.problems = problems;
  }
}

/** 노드 · 엣지 · 동작 · 갈래의 id */
export const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
/** 출력 · 입력 · 변수 · 시크릿 이름 — 표현식에 그대로 들어간다 */
export const NAME_RE = /^[\p{L}\p{N}_]{1,64}$/u;


export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

/** 문제를 모으면서 읽는다. 틀린 칸은 기록하고 대체값을 돌려준다 — 끝까지 읽어야 문제를 다 모은다 */
export class Checker {
  readonly problems: string[] = [];

  fail(where: string, msg: string): void {
    this.problems.push(`${where}: ${msg}`);
  }

  obj(v: unknown, where: string): Obj {
    if (isObj(v)) return v;
    this.fail(where, "객체여야 합니다");
    return {};
  }

  arr(o: Obj, key: string, where: string, optional = false): unknown[] {
    const v = o[key];
    if (v === undefined && optional) return [];
    if (Array.isArray(v)) return v;
    this.fail(where, `${key}는 배열이어야 합니다`);
    return [];
  }

  str(o: Obj, key: string, where: string, fb?: string): string {
    const v = o[key];
    if (v === undefined && fb !== undefined) return fb;
    if (typeof v === "string") return v;
    this.fail(where, `${key}는 글자여야 합니다`);
    return fb ?? "";
  }

  /** 비어 있으면 안 되는 글자 */
  text(o: Obj, key: string, where: string): string {
    const s = this.str(o, key, where);
    if (typeof o[key] === "string" && s.trim() === "") this.fail(where, `${key}가 비었습니다`);
    return s;
  }

  strOrNull(o: Obj, key: string, where: string): string | null {
    const v = o[key];
    if (v === undefined || v === null) return null;
    if (typeof v === "string") return v;
    this.fail(where, `${key}는 글자 또는 null이어야 합니다`);
    return null;
  }

  bool(o: Obj, key: string, where: string, fb?: boolean): boolean {
    const v = o[key];
    if (v === undefined && fb !== undefined) return fb;
    if (typeof v === "boolean") return v;
    this.fail(where, `${key}는 true/false여야 합니다`);
    return fb ?? false;
  }

  int(o: Obj, key: string, where: string, fb: number, min = 0): number {
    const v = o[key];
    if (v === undefined) return fb;
    if (typeof v === "number" && Number.isInteger(v) && v >= min) return v;
    this.fail(where, `${key}는 ${min} 이상의 정수여야 합니다`);
    return fb;
  }

  intOrNull(o: Obj, key: string, where: string, min = 1): number | null {
    const v = o[key];
    if (v === undefined || v === null) return null;
    if (typeof v === "number" && Number.isInteger(v) && v >= min) return v;
    this.fail(where, `${key}는 ${min} 이상의 정수 또는 null이어야 합니다`);
    return null;
  }

  oneOf<T extends string>(allowed: readonly T[], o: Obj, key: string, where: string, fb?: T): T {
    const v = o[key];
    if (v === undefined && fb !== undefined) return fb;
    if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
    this.fail(where, `${key}: 모르는 값 ${JSON.stringify(v)} (가능: ${allowed.join(" | ")})`);
    return fb ?? allowed[0]!;
  }

  id(o: Obj, key: string, where: string): string {
    const s = this.str(o, key, where);
    if (typeof o[key] === "string" && !ID_RE.test(s)) this.fail(where, `${key} "${s}"는 영문자로 시작하는 영문 · 숫자 · _ · - 여야 합니다`);
    return s;
  }

  name(o: Obj, key: string, where: string): string {
    const s = this.str(o, key, where);
    if (typeof o[key] === "string" && !NAME_RE.test(s)) this.fail(where, `${key} "${s}"는 글자 · 숫자 · _ 만 쓸 수 있습니다(공백 · 점 불가)`);
    return s;
  }

  regex(s: string, where: string): void {
    try { new RegExp(s, "u"); } catch (e) { this.fail(where, `정규식이 틀렸습니다 — ${(e as Error).message}`); }
  }

  strRecord(v: unknown, where: string): Record<string, string> {
    if (v === undefined) return {};
    if (!isObj(v)) { this.fail(where, "객체여야 합니다"); return {}; }
    const out: Record<string, string> = {};
    for (const [k, x] of Object.entries(v)) {
      if (!NAME_RE.test(k)) this.fail(where, `이름 "${k}"는 글자 · 숫자 · _ 만 쓸 수 있습니다`);
      if (typeof x !== "string") this.fail(`${where}.${k}`, "글자여야 합니다");
      else out[k] = x;
    }
    return out;
  }

  /** 지문의 속성 — HTML 속성 이름 그대로라 NAME_RE를 안 건다 */
  strRecordLoose(v: unknown, where: string): Record<string, string> {
    if (v === undefined) return {};
    if (!isObj(v)) { this.fail(where, "객체여야 합니다"); return {}; }
    const out: Record<string, string> = {};
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "string") out[k] = x;
      else this.fail(`${where}.${k}`, "글자여야 합니다");
    }
    return out;
  }

  noDup(items: readonly string[], what: string, where: string): void {
    const seen = new Set<string>();
    for (const s of items) {
      if (seen.has(s)) this.fail(where, `${what} "${s}"가 두 번 있습니다`);
      seen.add(s);
    }
  }
}
