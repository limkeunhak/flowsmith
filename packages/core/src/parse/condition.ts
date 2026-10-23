/** 검문소 — 조건 노드(갈래 · 규칙 · 그다음) */
import { CONDITION_OPS, UNARY_OPS, type ConditionCase, type ConditionConfig, type Rule, type Then } from "../model.ts";
import { Checker, type Obj } from "./checker.ts";

function then(c: Checker, v: unknown, where: string): Then {
  const o = c.obj(v, where);
  const kind = c.oneOf(["next", "end"] as const, o, "kind", where);
  if (kind === "next") return { kind };
  return { kind, status: c.oneOf(["success", "failure"] as const, o, "status", where), message: c.str(o, "message", where, "") };
}

export function rule(c: Checker, v: unknown, where: string): Rule {
  const o = c.obj(v, where);
  const op = c.oneOf(CONDITION_OPS, o, "op", where);
  const right = c.strOrNull(o, "right", where);
  const unary = UNARY_OPS.includes(op);
  if (unary && right !== null) c.fail(where, `${op}는 오른쪽 값을 쓰지 않습니다`);
  if (!unary && right === null) c.fail(where, `${op}에는 오른쪽 값이 있어야 합니다`);
  if (op === "matches" && right !== null && !right.includes("{{")) c.regex(right, `${where}.right`);
  return { left: c.text(o, "left", where), op, right };
}

export function conditionConfig(c: Checker, o: Obj, where: string): ConditionConfig {
  const cases: ConditionCase[] = c.arr(o, "cases", where).map((x, i) => {
    const w = `${where}.cases[${i}]`;
    const k = c.obj(x, w);
    const id = c.id(k, "id", w);
    if (id === "else" || id === "out") c.fail(w, `갈래 id로 "${id}"는 쓸 수 없습니다(예약된 포트 이름)`);
    const rules = c.arr(k, "rules", w).map((r, j) => rule(c, r, `${w}.rules[${j}]`));
    if (Array.isArray(k["rules"]) && rules.length === 0) c.fail(w, "규칙이 하나도 없습니다");
    return { id, label: c.str(k, "label", w, id), match: c.oneOf(["all", "any"] as const, k, "match", w, "all"), rules, then: then(c, k["then"], `${w}.then`) };
  });
  if (Array.isArray(o["cases"]) && cases.length === 0) c.fail(where, "갈래가 하나도 없습니다");
  c.noDup(cases.map((k) => k.id), "갈래 id", where);
  const e = c.obj(o["else"], `${where}.else`);
  return { cases, else: { then: then(c, e["then"], `${where}.else.then`) } };
}
