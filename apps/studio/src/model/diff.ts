/**
 * **버전 비교** — 두 플로우(버전 · 초안)가 무엇이 다른지 사람 말로. 게시하기 전에 «무엇이 바뀌었나»를 본다(n8n · Jenkins 설정 이력처럼).
 *
 *   노드      더함 · 뺌 · 이름 · 설정(웹페이지는 동작마다 — 더함 · 뺌 · 바뀜 · 차례)
 *   선        더함 · 뺌
 *   그 밖     실행 입력 · 변수 · 시크릿 정의 · 설정(일정 · 알림 · 잠금 · 시간 · 브라우저 …) · 메모
 *
 * 순수하다 — 화면은 이 목록을 그리기만 한다. 위치(캔버스 자리)만 바뀐 것은 세지 않는다.
 */
import type { Flow, FlowNode, WebAction } from "@flowsmith/core";
import { describeAction } from "./describe.ts";

export type ChangeKind = "added" | "removed" | "changed";
export interface Change {
  kind: ChangeKind;
  /** 무리 — 「노드 ‘조회’」 · 「선」 · 「실행 입력」 · 「설정」 */
  where: string;
  /** 한 줄 — 「동작 3 «'조회' 버튼을 누릅니다»를 더했습니다」 */
  text: string;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const q = (s: string) => `«${s}»`;

/** 웹페이지 노드의 동작 — id로 짝을 짓는다(녹화로 더한 동작은 id가 새로 붙는다) */
function actionChanges(where: string, a: readonly WebAction[], b: readonly WebAction[], ctx: { flow: Flow; nodeId: string }): Change[] {
  const out: Change[] = [];
  const before = new Map(a.map((x, i) => [x.id, { x, i }]));
  const after = new Map(b.map((x, i) => [x.id, { x, i }]));
  for (const [id, { x, i }] of after) {
    const old = before.get(id);
    if (!old) out.push({ kind: "added", where, text: `동작 ${i + 1} ${q(describeAction(x, ctx))}를 더했습니다` });
    else if (!same(old.x, x)) out.push({ kind: "changed", where, text: `동작 ${i + 1}: ${q(describeAction(old.x, ctx))} → ${q(describeAction(x, ctx))}` });
  }
  for (const [id, { x, i }] of before) if (!after.has(id)) out.push({ kind: "removed", where, text: `동작 ${i + 1} ${q(describeAction(x, ctx))}를 뺐습니다` });
  // 차례만 바뀌었으면 — 남은 동작들의 순서
  const keep = (list: readonly WebAction[], other: Map<string, unknown>) => list.filter((x) => other.has(x.id)).map((x) => x.id);
  if (!same(keep(a, after), keep(b, before))) out.push({ kind: "changed", where, text: "동작의 차례가 바뀌었습니다" });
  return out;
}

/** 설정의 어떤 칸이 바뀌었나 — 칸 이름을 사람 말로 */
const CONFIG_LABEL: Record<string, string> = {
  start: "시작", code: "코드", outputs: "내놓는 이름", usesPage: "페이지 쓰기", timeoutMs: "시간 제한", cases: "갈래", else: "그 밖", extension: "확장", options: "확장 값",
  data: "저장할 값", target: "어디에", format: "형식", source: "읽을 것", missing: "없을 때", maxRows: "최대 행", flowId: "부를 워크플로우", version: "버전", items: "행들",
  params: "실행 입력", concurrency: "동시에", onError: "실패하면", method: "방식", url: "주소", query: "쿼리", headers: "헤더", body: "본문", steps: "단계",
  message: "안내", minRole: "승인할 사람", timeoutMin: "기다리는 시간",
};
function nodeChanges(a: FlowNode, b: FlowNode, ctx: { flow: Flow }): Change[] {
  const where = `노드 ${q(b.name)}`;
  const out: Change[] = [];
  if (a.name !== b.name) out.push({ kind: "changed", where, text: `이름 ${q(a.name)} → ${q(b.name)}` });
  if (a.type !== b.type) { out.push({ kind: "changed", where, text: "종류가 바뀌었습니다" }); return out; }
  if (a.type === "web" && b.type === "web") {
    if (!same(a.config.start, b.config.start)) out.push({ kind: "changed", where, text: "시작(주소 · 이어서 · 탭)이 바뀌었습니다" });
    out.push(...actionChanges(where, a.config.actions, b.config.actions, { flow: ctx.flow, nodeId: b.id }));
    return out;
  }
  const ac = a.config as unknown as Record<string, unknown>;
  const bc = b.config as unknown as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(ac), ...Object.keys(bc)])].filter((k) => !same(ac[k], bc[k]));
  if (keys.length) out.push({ kind: "changed", where, text: `설정이 바뀌었습니다 — ${keys.map((k) => CONFIG_LABEL[k] ?? k).join(" · ")}` });
  return out;
}

const SETTING_LABEL: Record<string, string> = {
  forbiddenLabels: "금지 버튼", defaultTimeoutMs: "기본 시간 제한", monitorIntervalMin: "변경 감시 주기", probeParams: "점검용 입력값", browser: "브라우저",
  schedules: "일정", retries: "다시 해 보기", retryDelayMs: "다시 해 보기 간격", actionPause: "동작 사이 쉬기", runTimeoutMin: "전체 시간 제한", notify: "알림", locks: "자원 잠금",
  after: "다른 워크플로우가 끝나면", fileTriggers: "파일이 생기면", wallet: "테스트 지갑",
};

/** a(예전) → b(지금)의 바뀐 것 — 같으면 빈 목록 */
export function diffFlows(a: Flow, b: Flow): Change[] {
  const out: Change[] = [];
  if (a.name !== b.name) out.push({ kind: "changed", where: "워크플로우", text: `이름 ${q(a.name)} → ${q(b.name)}` });
  if (a.description !== b.description) out.push({ kind: "changed", where: "워크플로우", text: "설명이 바뀌었습니다" });

  const an = new Map(a.nodes.map((n) => [n.id, n]));
  const bn = new Map(b.nodes.map((n) => [n.id, n]));
  for (const n of b.nodes) {
    const old = an.get(n.id);
    if (!old) out.push({ kind: "added", where: `노드 ${q(n.name)}`, text: "노드를 더했습니다" });
    else out.push(...nodeChanges(old, n, { flow: b }));
  }
  for (const n of a.nodes) if (!bn.has(n.id)) out.push({ kind: "removed", where: `노드 ${q(n.name)}`, text: "노드를 뺐습니다" });

  const edgeKey = (e: Flow["edges"][number]) => `${e.from.node}:${e.from.port}>${e.to.node}`;
  const nameOf = (id: string) => bn.get(id)?.name ?? an.get(id)?.name ?? id;
  const ae = new Set(a.edges.map(edgeKey));
  const be = new Set(b.edges.map(edgeKey));
  for (const e of b.edges) if (!ae.has(edgeKey(e))) out.push({ kind: "added", where: "선", text: `${q(nameOf(e.from.node))} → ${q(nameOf(e.to.node))} 이었습니다` });
  for (const e of a.edges) if (!be.has(edgeKey(e))) out.push({ kind: "removed", where: "선", text: `${q(nameOf(e.from.node))} → ${q(nameOf(e.to.node))} 끊었습니다` });

  const named = <T extends { name: string }>(where: string, xs: readonly T[], ys: readonly T[], show: (x: T) => string) => {
    const xm = new Map(xs.map((x) => [x.name, x]));
    const ym = new Map(ys.map((y) => [y.name, y]));
    for (const y of ys) { const x = xm.get(y.name); if (!x) out.push({ kind: "added", where, text: `${show(y)}를 더했습니다` }); else if (!same(x, y)) out.push({ kind: "changed", where, text: `${show(y)}가 바뀌었습니다` }); }
    for (const x of xs) if (!ym.has(x.name)) out.push({ kind: "removed", where, text: `${show(x)}를 뺐습니다` });
  };
  named("실행 입력", a.params, b.params, (p) => q(p.label || p.name));
  named("시크릿 정의", a.secrets, b.secrets, (s) => q(s.name));
  named("변수", Object.entries(a.vars).map(([name, value]) => ({ name, value })), Object.entries(b.vars).map(([name, value]) => ({ name, value })), (v) => q(v.name));
  if (!same([...(a.sharedVars ?? [])].sort(), [...(b.sharedVars ?? [])].sort())) out.push({ kind: "changed", where: "변수", text: "쓰는 공용 변수가 바뀌었습니다" });

  const as = a.settings as unknown as Record<string, unknown>;
  const bs = b.settings as unknown as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(as), ...Object.keys(bs)])].filter((k) => !same(as[k], bs[k]));
  for (const k of keys) out.push({ kind: "changed", where: "설정", text: `${SETTING_LABEL[k] ?? k}이(가) 바뀌었습니다` });

  if (!same((a.notes ?? []).map((n) => n.text), (b.notes ?? []).map((n) => n.text))) out.push({ kind: "changed", where: "메모", text: "메모가 바뀌었습니다" });
  return out;
}
