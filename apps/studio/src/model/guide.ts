/**
 * **다음 할 일** 계산 — 순수하다. 화면은 editor/Guide.tsx (PLAN §18).
 * ★저장하지 않는다 — 언제나 지금 초안 · 실행 기록 · 게시 상태에서 계산한다.
 */
import { describeCron, explainProblem, type Flow } from "@flowsmith/core";

export interface GuideItem {
  id: string;
  text: string;
  done: boolean;
  action?: { label: string; run: () => void };
}

export interface GuideActions {
  openNode: (id: string) => void;
  openNotify: () => void;
  openProblems: () => void;
  openPublish: () => void;
}

/** 남은 일 — 순서가 곧 권하는 차례다 */
/**
 * published — 게시된 버전과, 지금 초안이 그것과 같은지(같지 않으면 «고친 것을 게시하기»).
 * 숫자만 주면(옛 부름) 같다고 본다
 */
export function guideItems(flow: Flow, problems: readonly string[], history: readonly { status: string }[], published: number | null | { version: number | null; upToDate: boolean }, act: GuideActions): GuideItem[] {
  const pub = typeof published === "object" && published !== null ? published : { version: published, upToDate: true };
  const items: GuideItem[] = [];
  const covered = new Set<string>();
  // 빈 플로우 — «노드가 하나도 없습니다»를 문제로 세지 않고 첫 할 일로
  if (flow.nodes.length === 0) items.push({ id: "first", text: "첫 단계 더하기 — 가운데 ＋ (보통은 «웹페이지»)", done: false });
  problems = problems.filter((p) => p !== "노드가 하나도 없습니다");
  for (const n of flow.nodes) {
    if (n.type === "web") {
      const noUrl = n.config.start.kind === "url" && n.config.start.url.trim() === "";
      // «페이지 접속»(나눈 노드) — 동작 없이 주소만 열고 뒤 웹 노드가 이어서 한다. 할 일은 주소뿐
      const opensOnly = n.config.actions.length === 0 && n.config.start.kind !== "continue"
        && flow.edges.some((e) => e.from.node === n.id && flow.nodes.some((x) => x.id === e.to.node && x.type === "web" && x.config.start.kind === "continue"));
      items.push(opensOnly
        ? { id: `rec-${n.id}`, text: `「${n.name}」 — 시작 주소 넣기`, done: !noUrl, action: { label: "열기", run: () => act.openNode(n.id) } }
        : { id: `rec-${n.id}`, text: noUrl ? `「${n.name}」 — 시작 주소를 넣고 녹화로 동작 만들기` : `「${n.name}」 — 녹화로 동작 만들기(직접 해 보이면 기록됩니다)`, done: n.config.actions.length > 0 && !noUrl, action: { label: "열기", run: () => act.openNode(n.id) } });
      covered.add(n.id);
    }
    if (n.type === "transform") {
      items.push({ id: `src-${n.id}`, text: `「${n.name}」 — 다듬을 목록 고르기(앞 단계를 녹화한 뒤)`, done: n.config.source.trim() !== "", action: { label: "열기", run: () => act.openNode(n.id) } });
      covered.add(n.id);
    }
  }
  for (const r of flow.settings.notify) {
    if (r.channel === "email" && r.enabled) items.push({ id: `mail-${r.id}`, text: "알림 — 받는 메일 적기", done: r.url.trim() !== "", action: { label: "알림", run: act.openNotify } });
  }
  // 위에서 다룬 노드의 문제(동작 없음 · 목록 없음)는 빼고 센다 — 같은 일을 두 번 시키지 않는다
  //  (어느 노드의 문제인지는 core explainProblem이 안다 — 모양 문제 「노드 id.자리: …」 · 의미 문제 「노드 '이름'(id) …」 둘 다)
  const rest = problems.filter((p) => { const n = explainProblem(p, flow).nodeId; return !(n !== null && covered.has(n)) && !/^(알림 |settings\.notify)/.test(p); });
  items.push({ id: "problems", text: rest.length ? `그 밖의 문제 ${rest.length}개 고치기` : "그 밖의 문제 없음", done: rest.length === 0, action: { label: "보기", run: act.openProblems } });
  items.push({ id: "run", text: "한 번 돌려 보기 — 아래 «워크플로우 실행»", done: history.some((h) => h.status === "success") });
  const when = flow.settings.schedules.filter((s) => s.enabled).map((s) => { try { return describeCron(s.cron); } catch { return s.cron; } });
  items.push(pub.version !== null && !pub.upToDate
    ? { id: "publish", text: `고친 것을 새 버전으로 게시하기 — 지금 도는 것은 v${pub.version}입니다`, done: false, action: { label: "게시", run: act.openPublish } }
    : { id: "publish", text: `게시하기 — ${when.length ? `게시하면 ${when.join(" · ")}에 돕니다` : "일정 · 알림은 게시된 버전으로 돕니다"}`, done: pub.version !== null, action: { label: "게시", run: act.openPublish } });
  return items;
}
