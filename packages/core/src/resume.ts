/**
 * **여기서부터 다시** — 지난 실행의 한 단계부터 다시 돌릴 계획. 순수하다(서버가 실행을 시작하기 전에 · 화면이 미리 보이기 전에 부른다).
 *
 *   그 단계와 그 뒤(그 단계에서 닿는 모든 노드)는 진짜로 돈다.
 *   그 앞은 지난 실행이 내놓은 출력을 **고정된 출력**(엔진의 pins)으로 쓴다 — 돌지 않는다.
 *   ★예외 — 다시 도는 앞 단계:
 *     브라우저  그 단계부터 뒤에 앞 화면을 이어 쓰는 노드(웹페이지 «이어서» · «탭» · 페이지를 쓰는 커스텀)가 있으면,
 *              앞 단계 중 그 단계의 조상인 웹페이지 노드는 다시 돈다 — 실행마다 브라우저가 새로 뜨므로 화면(로그인 · 열린 페이지)을 다시 만든다
 *     가린 값  지난 출력에 개인정보라 기록하지 않은 값이 있으면 그 노드는 다시 돈다(가린 글자를 뒤로 넘기지 않게)
 *   조건 노드는 고정하지 않는다 — 받은 값으로 다시 고른다(엔진도 고정하지 않는다).
 *   그 단계의 조상 중 지난 실행에서 끝나지 않은 것이 있으면 할 수 없다(넘겨줄 출력이 없다).
 */
import { compile } from "./graph.ts";
import type { Flow } from "./model.ts";
import type { NodeStatus, Output } from "./run-state.ts";

export interface ResumeSource {
  id: string;
  status: NodeStatus;
  output: Output | null;
}

export interface ResumePlan {
  from: string;
  /** 지난 출력을 쓰는 노드 → 그 출력 */
  pins: Record<string, Output>;
  /** 그 단계 앞인데 다시 도는 노드와 까닭 */
  again: { id: string; why: "browser" | "masked" }[];
}

export class ResumeError extends Error {
  constructor(message: string) { super(message); this.name = "ResumeError"; }
}

/** 페이지(브라우저 화면)를 앞에서 이어받는 노드 */
const usesEarlierPage = (n: Flow["nodes"][number]): boolean =>
  (n.type === "web" && n.config.start.kind !== "url") || (n.type === "custom" && n.config.usesPage);

/**
 * 계획 — from은 다시 시작할 노드. masked(출력)가 참이면 그 출력은 가린 값이 있어 쓸 수 없다.
 * 지금 플로우(flow)로 짠다 — 초안이 바뀌었으면 지금 초안의 연결대로(없어진 노드의 출력은 버린다)
 */
export function planResume(flow: Flow, source: readonly ResumeSource[], from: string, masked: (o: Output) => boolean = () => false): ResumePlan {
  const g = compile(flow);
  const start = g.node.get(from);
  if (!start) throw new ResumeError(`단계 "${from}"가 지금 워크플로우에 없습니다`);
  const ran = new Map(source.map((s) => [s.id, s]));
  // 그 단계와 그 뒤 — 거기서 닿는 모든 노드
  const after = new Set(g.order.filter((id) => id === from || g.ancestors.get(id)?.has(from)));
  const before = g.order.filter((id) => !after.has(id));
  const ancestors = g.ancestors.get(from) ?? new Set<string>();

  for (const id of ancestors) {
    const s = ran.get(id);
    if (g.node.get(id)!.type !== "condition" && (!s || s.status !== "succeeded" || s.output === null)) {
      throw new ResumeError(`앞 단계 «${g.node.get(id)!.name}»가 그 실행에서 끝나지 않아 «${start.name}»부터 다시 할 수 없습니다 — 처음부터 다시 실행하세요`);
    }
  }
  const needPage = [...after].some((id) => usesEarlierPage(g.node.get(id)!));
  const pins: Record<string, Output> = {};
  const again: ResumePlan["again"] = [];
  for (const id of before) {
    const n = g.node.get(id)!;
    const s = ran.get(id);
    if (n.type === "condition") continue;
    if (needPage && n.type === "web" && ancestors.has(id)) { again.push({ id, why: "browser" }); continue; }
    if (!s || s.status !== "succeeded" || s.output === null) continue;   // 그 실행에서 돌지 않은 갈래 — 이번에도 조건이 고른다
    if (masked(s.output)) { again.push({ id, why: "masked" }); continue; }
    pins[id] = s.output;
  }
  return { from, pins, again };
}
