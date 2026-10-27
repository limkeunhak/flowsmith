/**
 * **깨졌을 때 고치기** — 실패마다 «무엇을 해 주세요»와 고치는 길(PLAN §19). 순수하다.
 *
 * ★고치는 것은 **사람**이다(결정 3). 엔진은 후보를 붙이기만 하고, 화면은 사람이 누른 대로만 바꾼다 —
 *  «이 위치로 바꾸기»는 지금 페이지에서 정확히 하나를 가리키는 후보에만 보이고, 누르기 전에는 바뀌지 않는다.
 */
import type { Flow, Locator, Target, WebAction } from "@flowsmith/core";

export type Problem = "missing" | "many" | "forbidden" | "notFilled" | "noPage" | "refused" | "mismatch" | "check" | "timeout" | "stopped" | "other";

/** 실패 카드의 «무엇을 해 주세요» — 사람 말로, 무엇이 · 왜 · 어떻게 */
export function fixHint(problem: Problem, label: string | null): string {
  const it = label ? `«${label}»` : "요소";
  switch (problem) {
    case "missing": return `${it}이(가) 화면에 없습니다. 사이트가 바뀌었다면 [다시 지정]을 눌러 페이지에서 그 요소를 다시 골라 주세요. 입력값(주문번호 등)이 틀려도 이렇게 될 수 있습니다.`;
    case "many": return `${it}와(과) 비슷한 것이 여러 개라 어느 것인지 정할 수 없어 멈췄습니다. [다시 지정]으로 더 정확히 골라 주세요.`;
    case "notFilled": return `${it}에 값을 넣었는데 남지 않았습니다. 칸이 바뀌었을 수 있습니다 — [다시 지정]으로 칸을 다시 골라 주세요.`;
    case "timeout": return "시간 안에 화면이 준비되지 않았습니다. 사이트가 잠깐 느렸다면 [다시 해 보기 켜기]로 몇 번 더 해 보게 하고, 계속되면 노드를 열어 시간 제한을 늘려 주세요.";
    case "forbidden": return `${it}은(는) 누르면 안 되는 버튼(금지 버튼)이라 누르지 않고 멈췄습니다. 정말 눌러야 한다면 워크플로우 설정의 금지 버튼 목록을 고쳐 주세요.`;
    case "noPage": return "이어서 쓸 페이지가 없습니다. 앞에 웹페이지 노드를 잇거나, 노드를 열어 시작 주소를 정해 주세요.";
    case "refused": return "고르면 안 되는 행이라 멈췄습니다 — 사이트 문제가 아니라 이번 입력값의 문제입니다. 입력값을 확인해 주세요.";
    case "check": return "값이 기대와 달라 불통과입니다 — 아래 검사 표에서 기대값과 실제값을 보세요. 사이트가 바뀐 것인지, 기대값을 고쳐야 하는지 정해 주세요.";
    case "mismatch": return "화면이 기대한 건이 아니라 멈췄습니다 — 다른 건을 처리하지 않으려고 멈춘 것입니다. 입력값을 확인해 주세요.";
    case "stopped": return "실행을 멈췄습니다.";
    case "other": return "노드를 열어 설정을 확인해 주세요. 메시지가 무엇을 말하는지 모르겠으면 이 실행 기록 주소를 개발자에게 보내 주세요.";
  }
}

/** 사이트가 바뀌어 생기는 실패 — [다시 지정]이 고치는 길 */
export const REPICKABLE: readonly Problem[] = ["missing", "many", "notFilled"];

/** 동작의 요소 — 녹화로 다시 지정할 수 있는 것 */
export function targetOf(a: WebAction): Target | null {
  switch (a.kind) {
    case "readTable": return a.table.rows;
    case "pickRow": return a.pick.rows;
    case "wait": return "target" in a.wait ? a.wait.target : null;
    case "goto": case "closeWindow": case "switchWindow": case "recheck": return null;
    case "press": return a.target;
    // 사람 기다리기 — «이 화면일 때만»이 있으면 그것, 없으면 끝났다는 표시의 요소
    case "human": return a.appears ?? (a.done.kind === "url" ? null : a.done.target);
    case "walletApprove": return a.done.kind === "url" ? null : a.done.target;
    case "save": return null;
    default: return a.target;
  }
}

/** 동작의 요소를 바꾼다 — 나머지(값 · 출력 이름 · 되돌릴 수 없음)는 그대로 */
export function withTarget(a: WebAction, target: Target): WebAction {
  switch (a.kind) {
    case "readTable": return { ...a, table: { ...a.table, rows: target } };
    case "pickRow": return { ...a, pick: { ...a.pick, rows: target } };
    case "wait": return "target" in a.wait ? { ...a, wait: { ...a.wait, target } } : a;
    case "goto": case "closeWindow": case "switchWindow": case "recheck": return a;
    case "human": return a.appears ? { ...a, appears: target } : a.done.kind === "url" ? a : { ...a, done: { ...a.done, target } };
    case "walletApprove": return a.done.kind === "url" ? a : { ...a, done: { ...a.done, target } };
    case "save": return a;
    default: return { ...a, target };
  }
}

const same = (x: Locator, y: Locator) => x.kind === y.kind && x.value === y.value && (x.name ?? "") === (y.name ?? "");

/**
 * 후보를 1순위로 — 사람이 «이 위치로 바꾸기»를 눌렀을 때. 그 동작이 초안에 없으면 null
 * (게시된 버전에서 실패했는데 초안에서 그 동작을 지웠을 수 있다)
 */
export function promoteCandidate(flow: Flow, nodeId: string, actionId: string, locator: Locator): Flow | null {
  const n = flow.nodes.find((x) => x.id === nodeId);
  const a = n?.type === "web" ? n.config.actions.find((x) => x.id === actionId) : undefined;
  const t = a ? targetOf(a) : null;
  if (!a || !t) return null;
  const rest = t.locators.filter((l) => !same(l, locator));
  const next: Target = { ...t, locators: [locator, ...rest], verifiedAt: null };
  return { ...flow, nodes: flow.nodes.map((x) => (x.id !== nodeId || x.type !== "web" ? x : { ...x, config: { ...x.config, actions: x.config.actions.map((y) => (y.id === actionId ? withTarget(y, next) : y)) } })) };
}

/** 그 동작이 초안에 있나 — 고치는 단추를 보일지 */
export function hasAction(flow: Flow, nodeId: string, actionId: string): boolean {
  const n = flow.nodes.find((x) => x.id === nodeId);
  return n?.type === "web" && n.config.actions.some((a) => a.id === actionId);
}

/** 실패 카드의 고치는 단추가 편집 화면에 부탁하는 일 */
export type Fix =
  | { kind: "repick"; nodeId: string; actionId: string }
  | { kind: "candidate"; nodeId: string; actionId: string; locator: Locator }
  | { kind: "open"; nodeId: string }
  | { kind: "retries" }
  | { kind: "settings" };
