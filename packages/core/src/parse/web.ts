/** 검문소 — 웹페이지 노드(위치 · 지문 · 기다리기 · 표 · 행 고르기 · 동작) */
import {
  ACTION_KINDS, HUMAN_DONE_KINDS, HUMAN_TIMEOUT, type HumanDone, LOCATOR_KINDS, READ_STRATEGIES, READ_TRANSFORMS, RISKS, ROW_PICK_BY, WAIT_KINDS, type Fingerprint, type Locator, type RowPick, type TableColumn, type TableTarget, type Target, type Wait, type WebAction, type WebConfig,
} from "../model.ts";
import { Checker, type Obj } from "./checker.ts";
import { rule } from "./condition.ts";

function locator(c: Checker, v: unknown, where: string): Locator {
  const o = c.obj(v, where);
  const kind = c.oneOf(LOCATOR_KINDS, o, "kind", where);
  const value = c.text(o, "value", where);
  const name = c.strOrNull(o, "name", where);
  return name === null ? { kind, value } : { kind, value, name };
}

function fingerprint(c: Checker, v: unknown, where: string): Fingerprint | null {
  if (v === undefined || v === null) return null;
  const o = c.obj(v, where);
  return {
    tag: c.str(o, "tag", where, ""),
    attrs: c.strRecordLoose(o["attrs"], `${where}.attrs`),
    text: c.str(o, "text", where, ""),
    nearText: c.str(o, "nearText", where, ""),
  };
}

export function target(c: Checker, v: unknown, where: string): Target {
  const o = c.obj(v, where);
  const locators = c.arr(o, "locators", where).map((x, i) => locator(c, x, `${where}.locators[${i}]`));
  if (Array.isArray(o["locators"]) && locators.length === 0) c.fail(where, "위치가 하나도 없습니다 — 레코더로 다시 지정하세요");
  return {
    label: c.text(o, "label", where),
    locators,
    fingerprint: fingerprint(c, o["fingerprint"], `${where}.fingerprint`),
    frames: c.arr(o, "frames", where, true).map((x, i) => {
      if (typeof x !== "string" || x.trim() === "") { c.fail(`${where}.frames[${i}]`, "iframe 위치(css)여야 합니다"); return ""; }
      return x;
    }),
    verifiedAt: c.strOrNull(o, "verifiedAt", where),
  };
}

function wait(c: Checker, v: unknown, where: string): Wait {
  const o = c.obj(v, where);
  const kind = c.oneOf(WAIT_KINDS, o, "kind", where);
  switch (kind) {
    case "fixed": {
      const ms = c.int(o, "ms", where, 0, 1);
      if (o["ms"] === undefined) c.fail(where, "ms가 없습니다");
      return { kind, ms };
    }
    case "visible":
    case "hidden": return { kind, target: target(c, o["target"], `${where}.target`) };
    case "url": {
      const pattern = c.text(o, "pattern", where);
      c.regex(pattern, `${where}.pattern`);
      return { kind, pattern };
    }
    case "networkIdle": return { kind };
    case "filled": return { kind, target: target(c, o["target"], `${where}.target`) };
  }
}

function table(c: Checker, v: unknown, where: string): TableTarget {
  const o = c.obj(v, where);
  const columns: TableColumn[] = c.arr(o, "columns", where).map((x, i) => {
    const w = `${where}.columns[${i}]`;
    const col = c.obj(x, w);
    return { name: c.name(col, "name", w), selector: c.text(col, "selector", w), strategy: c.oneOf(READ_STRATEGIES, col, "strategy", w, "auto") };
  });
  if (Array.isArray(o["columns"]) && columns.length === 0) c.fail(where, "열이 하나도 없습니다");
  c.noDup(columns.map((x) => x.name), "열 이름", where);
  return {
    label: c.text(o, "label", where),
    rows: target(c, o["rows"], `${where}.rows`),
    columns,
    maxRows: c.int(o, "maxRows", where, 100, 1),
  };
}

function rowPick(c: Checker, v: unknown, where: string): RowPick {
  const o = c.obj(v, where);
  let refuse: RowPick["refuse"] = null;
  if (o["refuse"] != null) {
    const r = c.obj(o["refuse"], `${where}.refuse`);
    const values = c.arr(r, "values", `${where}.refuse`).map((x) => String(x)).filter((x) => x.trim() !== "");
    if (values.length === 0) c.fail(`${where}.refuse`, "고르면 안 되는 값을 하나 이상 적으세요");
    refuse = { column: c.text(r, "column", `${where}.refuse`), values, reason: c.text(r, "reason", `${where}.refuse`) };
  }
  const by = c.oneOf(ROW_PICK_BY, o, "by", where, "key");
  const value = c.text(o, "value", where);
  // 몇 번째 — 글자로 적었으면 0이 아닌 정수여야 한다(표현식이면 돌 때 본다)
  if (by === "index" && !value.includes("{{") && !/^-?[1-9]\d*$/.test(value.trim())) c.fail(where, `몇 번째(value)는 1 · 2 · 3 … 또는 끝에서 -1 · -2 …입니다 — "${value}"`);
  return {
    label: c.text(o, "label", where),
    rows: target(c, o["rows"], `${where}.rows`),
    by,
    keyColumn: by === "key" ? c.text(o, "keyColumn", where) : c.str(o, "keyColumn", where, ""),
    keyLabel: c.str(o, "keyLabel", where, ""),
    value,
    click: c.str(o, "click", where, ""),
    refuse,
  };
}

function action(c: Checker, v: unknown, where: string): WebAction {
  const o = c.obj(v, where);
  const base = {
    id: c.id(o, "id", where),
    risk: c.oneOf(RISKS, o, "risk", where, "safe"),
    timeoutMs: c.intOrNull(o, "timeoutMs", where),
    optional: c.bool(o, "optional", where, false),
    ...(o["retries"] != null ? { retries: Math.min(5, c.int(o, "retries", where, 0, 0)) } : {}),
    ...(o["when"] != null ? { when: rule(c, o["when"], `${where}.when`) } : {}),
  };
  const kind = c.oneOf(ACTION_KINDS, o, "kind", where);
  const tgt = () => target(c, o["target"], `${where}.target`);
  switch (kind) {
    case "goto": return { ...base, kind, url: c.text(o, "url", where) };
    case "click": return { ...base, kind, target: tgt(), popup: c.bool(o, "popup", where, false) };
    case "fill": return { ...base, kind, target: tgt(), value: c.str(o, "value", where) };
    case "select": return { ...base, kind, target: tgt(), value: c.text(o, "value", where) };
    case "check": return { ...base, kind, target: tgt(), checked: c.bool(o, "checked", where, true) };
    case "press": return { ...base, kind, target: o["target"] == null ? null : tgt(), key: c.text(o, "key", where) };
    case "wait": return { ...base, kind, wait: wait(c, o["wait"], `${where}.wait`) };
    case "read": {
      const strategy = c.oneOf(READ_STRATEGIES, o, "strategy", where, "auto");
      const attribute = c.strOrNull(o, "attribute", where);
      if (strategy === "attribute" && (attribute === null || attribute.trim() === "")) c.fail(where, "strategy가 attribute면 attribute(속성 이름)가 있어야 합니다");
      if (strategy !== "attribute" && attribute !== null) c.fail(where, "attribute는 strategy가 attribute일 때만 씁니다");
      const transform = o["transform"] == null ? null : c.oneOf(READ_TRANSFORMS, o, "transform", where);
      return { ...base, kind, target: tgt(), output: c.name(o, "output", where), strategy, attribute, transform };
    }
    case "readTable": return { ...base, kind, table: table(c, o["table"], `${where}.table`), output: c.name(o, "output", where) };
    case "closeWindow": return { ...base, kind };
    case "pickRow": return { ...base, kind, pick: rowPick(c, o["pick"], `${where}.pick`) };
    case "assert": return { ...base, kind, target: tgt(), strategy: c.oneOf(READ_STRATEGIES, o, "strategy", where, "auto"), equals: c.text(o, "equals", where) };
    case "human": {
      const t = base.timeoutMs;
      if (t !== null && (t < HUMAN_TIMEOUT.minMs || t > HUMAN_TIMEOUT.maxMs)) c.fail(where, `사람을 기다리는 시간(timeoutMs)은 ${HUMAN_TIMEOUT.minMs / 1000}초~${HUMAN_TIMEOUT.maxMs / 60_000}분입니다`);
      const d = c.obj(o["done"], `${where}.done`);
      const dk = c.oneOf(HUMAN_DONE_KINDS, d, "kind", `${where}.done`);
      const done: HumanDone = dk === "url" ? (() => { const pattern = c.text(d, "pattern", `${where}.done`); c.regex(pattern, `${where}.done.pattern`); return { kind: dk, pattern }; })()
        : { kind: dk, target: target(c, d["target"], `${where}.done.target`) };
      // ★«있을 때만»은 이 동작에서 «이 화면일 때만»(appears)이 맡는다 — 둘을 같이 켜지 않는다
      if (base.optional) c.fail(where, "사람 기다리기는 «있을 때만» 대신 «이 화면일 때만»(appears)을 씁니다");
      return { ...base, kind, prompt: c.text(o, "prompt", where), appears: o["appears"] == null ? null : target(c, o["appears"], `${where}.appears`), done };
    }
  }
}

export function webConfig(c: Checker, o: Obj, where: string): WebConfig {
  const s = c.obj(o["start"], `${where}.start`);
  const kind = c.oneOf(["url", "continue", "tab"] as const, s, "kind", `${where}.start`);
  const start: WebConfig["start"] = kind === "url" ? { kind, url: c.text(s, "url", `${where}.start`) }
    : kind === "tab" ? { kind, match: c.text(s, "match", `${where}.start`) }
    : { kind };
  const actions = c.arr(o, "actions", where).map((x, i) => action(c, x, `${where}.actions[${i}]`));
  c.noDup(actions.map((a) => a.id), "동작 id", where);
  c.noDup(actions.flatMap((a) => (a.kind === "read" || a.kind === "readTable" ? [a.output] : [])), "출력 이름", where);
  // ★주소로 · 사람이 연 탭에서 시작하면 동작이 없어도 된다 — «페이지 접속»만 하는 노드(사용자 요청 2026-10-22 · 노드 나누기).
  //   앞 페이지에서 이어서 아무것도 안 하는 노드는 뜻이 없다
  if (Array.isArray(o["actions"]) && actions.length === 0 && kind === "continue") c.fail(where, "동작이 하나도 없습니다 — 앞 페이지에서 이어서 할 일을 더하세요");
  return { start, actions };
}
