/** 검문소 — 커스텀 · 확장 · 파일 쓰기 · 파일 읽기 · 다른 플로우 실행 · HTTP 요청 노드 */
import {
  CONDITION_OPS, FORMAT_KINDS, TRANSFORM_STEP_KINDS, UNARY_OPS, type TransformConfig, type TransformStep,
  HTTP_BODY_KINDS, HTTP_METHODS, HTTP_RESPONSE_KINDS, MAX_CALL_CONCURRENCY, type FlowCallConfig, type CustomConfig, type ExtensionConfig, type HttpConfig, type HttpPair,
  APPROVAL_ROLES, APPROVAL_TIMEOUT, type ApprovalConfig,
  CHECK_OP_LABEL, CHECK_OPS, CHECK_UNARY_OPS, type CheckConfig, type CheckItem,
} from "../model.ts";
import {
  badDir, badFileName, READ_SCOPES, SEQUENCE_EVERY, STORE_FORMATS, STORE_SCOPES, type FileReadConfig, type ReadPick, STORE_KINDS, TIME_UNITS, WRITE_MODES, type Rolling, type StoreConfig,
} from "../nodes/file.ts";
import { isSingleRefTemplate } from "../expr.ts";
import { Checker, ID_RE, NAME_RE, type Obj } from "./checker.ts";

export function customConfig(c: Checker, o: Obj, where: string): CustomConfig {
  const outputs = c.arr(o, "outputs", where, true).map((x, i) => {
    if (typeof x !== "string" || !NAME_RE.test(x)) { c.fail(`${where}.outputs[${i}]`, "글자 · 숫자 · _ 로 된 이름이어야 합니다"); return ""; }
    return x;
  });
  c.noDup(outputs, "출력 이름", where);
  return { code: c.text(o, "code", where), outputs, usesPage: c.bool(o, "usesPage", where, false), timeoutMs: c.intOrNull(o, "timeoutMs", where) };
}

export function extensionConfig(c: Checker, o: Obj, where: string): ExtensionConfig {
  const extension = c.text(o, "extension", where);
  if (typeof o["extension"] === "string" && !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/.test(extension)) c.fail(where, `확장 id "${extension}"는 소문자 · 숫자 · - · 점으로 씁니다`);
  const outputs = c.arr(o, "outputs", where, true).map((x, i) => {
    if (typeof x !== "string" || !NAME_RE.test(x)) { c.fail(`${where}.outputs[${i}]`, "글자 · 숫자 · _ 로 된 이름이어야 합니다"); return ""; }
    return x;
  });
  c.noDup(outputs, "출력 이름", where);
  return { extension, options: c.strRecordLoose(o["options"], `${where}.options`), outputs };
}

export function storeConfig(c: Checker, o: Obj, where: string): StoreConfig {
  const t = c.obj(o["target"], `${where}.target`);
  const w = `${where}.target`;
  c.oneOf(STORE_KINDS, t, "kind", w);
  const r = c.obj(t["rolling"] ?? { kind: "none" }, `${w}.rolling`);
  const rk = c.oneOf(["none", "time", "sequence"] as const, r, "kind", `${w}.rolling`, "none");
  let rolling: Rolling;
  if (rk === "time") rolling = { kind: "time", unit: c.oneOf(TIME_UNITS, r, "unit", `${w}.rolling`, "day") };
  else if (rk === "sequence") {
    const every = c.oneOf(SEQUENCE_EVERY, r, "every", `${w}.rolling`, "run");
    const limit = c.intOrNull(r, "limit", `${w}.rolling`);
    if (every !== "run" && limit === null) c.fail(`${w}.rolling`, every === "rows" ? "몇 행마다 넘길지 정하세요" : "몇 바이트마다 넘길지 정하세요");
    rolling = { kind: "sequence", every, limit: every === "run" ? null : limit };
  } else rolling = { kind: "none" };
  const name = c.text(t, "name", w);
  const badName = typeof t["name"] === "string" && name.trim() !== "" ? badFileName(name) : null;
  if (badName) c.fail(w, badName);
  const dir = c.str(t, "dir", w, "");
  const badD = badDir(dir);
  if (badD) c.fail(w, badD);
  const csv = c.obj(t["csv"] ?? {}, `${w}.csv`);
  const columns = csv["columns"] == null ? null : c.arr(csv, "columns", `${w}.csv`).map((x, i) => {
    if (typeof x !== "string" || x.trim() === "") { c.fail(`${w}.csv.columns[${i}]`, "열 이름이 비었습니다"); return ""; }
    return x;
  });
  if (columns) c.noDup(columns, "열 이름", `${w}.csv`);
  const optName = (k: string): string | null => {
    const v = c.strOrNull(t, k, w);
    return v === null || v.trim() === "" ? null : v.trim();
  };
  return {
    data: c.text(o, "data", where),
    target: {
      kind: "file", scope: c.oneOf(STORE_SCOPES, t, "scope", w, "flow"), dir, name, rolling,
      format: c.oneOf(STORE_FORMATS, t, "format", w, "csv"),
      mode: c.oneOf(WRITE_MODES, t, "mode", w, "append"),
      csv: { header: c.bool(csv, "header", `${w}.csv`, true), bom: c.bool(csv, "bom", `${w}.csv`, true), columns: columns && columns.length ? columns : null },
      dedupeKey: optName("dedupeKey"),
      stampColumn: optName("stampColumn"),
      keepDays: c.intOrNull(t, "keepDays", w),
    },
  };
}

export function fileReadConfig(c: Checker, o: Obj, where: string): FileReadConfig {
  const w = `${where}.source`;
  const s = c.obj(o["source"], w);
  const scope = c.oneOf(READ_SCOPES, s, "scope", w, "flow");
  const flowId = c.strOrNull(s, "flowId", w);
  if (scope === "otherFlow" && (flowId === null || !ID_RE.test(flowId))) c.fail(w, "읽을 워크플로우를 고르세요");
  const name = c.text(s, "name", w);
  const badName = typeof s["name"] === "string" && name.trim() !== "" ? badFileName(name) : null;
  if (badName) c.fail(w, badName);
  const dir = c.str(s, "dir", w, "");
  const badD = badDir(dir);
  if (badD) c.fail(w, badD);
  const p = c.obj(s["pick"] ?? { kind: "latest" }, `${w}.pick`);
  const pk = c.oneOf(["fixed", "time", "latest"] as const, p, "kind", `${w}.pick`, "latest");
  let pick: ReadPick;
  if (pk === "time") {
    const off = p["offset"] ?? 0;
    if (typeof off !== "number" || !Number.isInteger(off) || off > 0 || off < -366) c.fail(`${w}.pick`, "offset은 0(이번) 또는 음수(지난)여야 합니다");
    pick = { kind: "time", unit: c.oneOf(TIME_UNITS, p, "unit", `${w}.pick`, "day"), offset: typeof off === "number" && Number.isInteger(off) ? off : 0 };
  } else pick = { kind: pk };
  const csv = c.obj(s["csv"] ?? {}, `${w}.csv`);
  return {
    source: {
      scope, flowId: scope === "otherFlow" ? flowId : null, dir, name, pick,
      format: c.oneOf(STORE_FORMATS, s, "format", w, "csv"),
      csv: { header: c.bool(csv, "header", `${w}.csv`, true) },
    },
    missing: c.oneOf(["fail", "empty"] as const, o, "missing", where, "fail"),
    maxRows: c.intOrNull(o, "maxRows", where),
  };
}

const HEADER_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;

function pairs(c: Checker, o: Obj, key: string, where: string, header = false): HttpPair[] {
  return c.arr(o, key, where, true).map((x, i) => {
    const w = `${where}.${key}[${i}]`;
    const p = c.obj(x, w);
    const name = c.text(p, "name", w);
    if (header && typeof p["name"] === "string" && name.trim() !== "" && !HEADER_RE.test(name)) c.fail(w, `헤더 이름 "${name}"를 쓸 수 없습니다(영문 · 숫자 · - 만)`);
    return { name: name.trim(), value: c.str(p, "value", w, "") };
  });
}

export function httpConfig(c: Checker, o: Obj, where: string): HttpConfig {
  const url = c.text(o, "url", where);
  // 주소 — 표현식으로 시작하면 실행할 때 본다. 아니면 http(s)여야 한다
  if (typeof o["url"] === "string" && url.trim() !== "" && !url.trim().startsWith("{{") && !/^https?:\/\//i.test(url.trim())) c.fail(where, `주소는 http:// 또는 https://로 시작해야 합니다 — ${url}`);
  const b = c.obj(o["body"] ?? { kind: "none" }, `${where}.body`);
  const kind = c.oneOf(HTTP_BODY_KINDS, b, "kind", `${where}.body`, "none");
  const method = c.oneOf(HTTP_METHODS, o, "method", where, "GET");
  const text = c.str(b, "text", `${where}.body`, "");
  if (kind === "json" && text.trim() !== "" && !isSingleRefTemplate(text)) {
    try { JSON.parse(text); } catch (e) { c.fail(`${where}.body`, `JSON 본문을 읽을 수 없습니다 — ${(e as Error).message} (값은 「"{{ $input.x }}"」처럼 따옴표 안에 씁니다)`); }
  }
  if ((method === "GET" || method === "HEAD") && kind !== "none") c.fail(where, `${method} 요청에는 본문을 넣지 않습니다`);
  const retries = c.intOrNull(o, "retries", where, 0);
  if (retries !== null && retries > 5) c.fail(where, "retries는 5번까지입니다");
  return {
    method, url,
    query: pairs(c, o, "query", where),
    headers: pairs(c, o, "headers", where, true),
    body: { kind, text, fields: pairs(c, b, "fields", `${where}.body`) },
    response: c.oneOf(HTTP_RESPONSE_KINDS, o, "response", where, "auto"),
    failOn: c.oneOf(["status", "never"] as const, o, "failOn", where, "status"),
    timeoutMs: c.intOrNull(o, "timeoutMs", where, 100),
    retries: retries === null ? null : Math.min(retries, 5),
  };
}

export function transformConfig(c: Checker, o: Obj, where: string): TransformConfig {
  const field = (s: Obj, key: string, w: string): string => {
    const v = c.str(s, key, w, "");
    if (v.trim() === "") c.fail(w, "어느 칸인지 고르세요");
    return v;
  };
  const steps = c.arr(o, "steps", where, true).map((x, i): TransformStep => {
    const w = `${where} 단계 ${i + 1}`;
    const s = c.obj(x, w);
    const kind = c.oneOf(TRANSFORM_STEP_KINDS, s, "kind", w);
    switch (kind) {
      case "pick": {
        const fields = c.arr(s, "fields", w).map((f, j) => { const p = c.obj(f, `${w}.fields[${j}]`); return { from: field(p, "from", w), to: c.str(p, "to", w, "") }; });
        if (fields.length === 0) c.fail(w, "남길 칸을 하나 이상 고르세요");
        c.noDup(fields.map((f) => f.to.trim() || f.from), "칸 이름", w);
        return { kind, fields };
      }
      case "filter": {
        const rules = c.arr(s, "rules", w).map((r, j) => {
          const p = c.obj(r, `${w}.rules[${j}]`);
          const op = c.oneOf(CONDITION_OPS, p, "op", w);
          return { field: field(p, "field", w), op, value: UNARY_OPS.includes(op) ? null : c.str(p, "value", w, "") };
        });
        if (rules.length === 0) c.fail(w, "조건을 하나 이상 정하세요");
        return { kind, match: c.oneOf(["all", "any"] as const, s, "match", w, "all"), rules };
      }
      case "dedupe":
        return { kind, fields: c.arr(s, "fields", w, true).map((f) => (typeof f === "string" ? f : "")).filter((f) => f.trim() !== "") };
      case "map":
        return {
          kind, field: field(s, "field", w),
          table: c.arr(s, "table", w).map((e, j) => { const p = c.obj(e, `${w}.table[${j}]`); return { from: c.str(p, "from", w, ""), to: c.str(p, "to", w, "") }; }),
          otherwise: c.oneOf(["keep", "empty", "fixed"] as const, s, "otherwise", w, "keep"), fixed: c.str(s, "fixed", w, ""),
        };
      case "format":
        return { kind, field: field(s, "field", w), as: c.oneOf(FORMAT_KINDS, s, "as", w), find: c.str(s, "find", w, ""), replace: c.str(s, "replace", w, "") };
      case "sort":
        return { kind, field: field(s, "field", w), order: c.oneOf(["asc", "desc"] as const, s, "order", w, "asc") };
      case "limit":
        return { kind, count: c.int(s, "count", w, 10, 1) };
    }
  });
  return { source: c.text(o, "source", where), steps };
}

export function flowCallConfig(c: Checker, o: Obj, where: string): FlowCallConfig {
  const flowId = c.text(o, "flowId", where);
  if (typeof o["flowId"] === "string" && flowId.trim() !== "" && !ID_RE.test(flowId)) c.fail(where, `워크플로우 id "${flowId}"를 읽을 수 없습니다`);
  const concurrency = c.int(o, "concurrency", where, 1, 1);
  if (concurrency > MAX_CALL_CONCURRENCY) c.fail(where, `동시 실행은 ${MAX_CALL_CONCURRENCY}개까지입니다`);
  return {
    flowId,
    version: c.oneOf(["active", "draft"] as const, o, "version", where, "active"),
    items: c.str(o, "items", where, ""),
    params: c.strRecordLoose(o["params"], `${where}.params`),
    concurrency: Math.min(concurrency, MAX_CALL_CONCURRENCY),
    onError: c.oneOf(["stop", "continue"] as const, o, "onError", where, "stop"),
  };
}

export function approvalConfig(c: Checker, o: Obj, where: string): ApprovalConfig {
  const timeoutMin = c.int(o, "timeoutMin", where, APPROVAL_TIMEOUT.defaultMin, 1);
  if (timeoutMin < APPROVAL_TIMEOUT.minMin || timeoutMin > APPROVAL_TIMEOUT.maxMin) c.fail(where, `기다리는 시간(timeoutMin)은 ${APPROVAL_TIMEOUT.minMin}분~${APPROVAL_TIMEOUT.maxMin / 60 / 24}일입니다`);
  return { message: c.text(o, "message", where), minRole: c.oneOf(APPROVAL_ROLES, o, "minRole", where, "runner"), timeoutMin };
}

/** 검사 — 항목마다 실제값 · 견주는 법 · 기대값(단항이면 없음) */
export function checkConfig(c: Checker, o: Obj, where: string): CheckConfig {
  const items: CheckItem[] = c.arr(o, "items", where).map((x, i) => {
    const k = c.obj(x, `${where}.items[${i}]`);
    const w = `${where} 검사 ${i + 1}${typeof k["label"] === "string" && k["label"] ? `(${k["label"]})` : ""}`;
    const op = c.oneOf(CHECK_OPS, k, "op", w);
    const expected = c.strOrNull(k, "expected", w);
    const unary = CHECK_UNARY_OPS.includes(op);
    if (unary && expected !== null) c.fail(w, `«${CHECK_OP_LABEL[op]}»는 기대값을 쓰지 않습니다`);
    if (!unary && expected === null) c.fail(w, `«${CHECK_OP_LABEL[op]}»에는 기대값이 있어야 합니다`);
    if (op === "matches" && expected !== null && !expected.includes("{{")) c.regex(expected, `${w}.expected`);
    const actual = c.str(k, "actual", w, "");
    if (actual.trim() === "") c.fail(w, "무엇을 볼지(실제값)를 고르세요 — 앞 노드의 값");
    if (expected !== null && expected.trim() === "" && !unary) c.fail(w, "기대값이 비었습니다");
    return { id: c.id(k, "id", w), label: c.str(k, "label", w, ""), actual, op, expected };
  });
  if (Array.isArray(o["items"]) && items.length === 0) c.fail(where, "검사 항목이 하나도 없습니다");
  c.noDup(items.map((x) => x.id), "검사 항목 id", where);
  return { items };
}
