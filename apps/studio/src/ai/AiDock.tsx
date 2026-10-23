/**
 * **떠 있는 AI 창** — 모든 화면 오른쪽 아래의 AI 단추 · 누르면 그 바로 왼쪽 위로 채팅 창(사용자 요청 2026-10-21).
 *   편집 화면이면 그 워크플로우를 고친다(적용 · 캔버스 미리 보기 — ai/bridge.ts) · 그 밖의 화면이면 새로 만든다(이대로 만들기).
 *   ★AI · 모델은 머리 띠 아래 줄(AiPicker)에서도 고른다(사용자 요청 2026-10-22) — 키는 «내 설정»에서만. 편집자 이상만 보인다.
 */
import { useEffect, useState } from "react";
import type { Flow } from "@flowsmith/core";
import { api, ApiError } from "../api.ts";
import { IconChevronDown, IconX } from "../icons.tsx";
import { useMe } from "../shell/me.ts";
import { AiChat, forgetSession } from "./AiChat.tsx";
import { AiPicker, useAiChoice } from "./AiPicker.tsx";
import { aiBridge, useAiBridge } from "./bridge.ts";

export function AiDock() {
  const me = useMe();
  const { open, target } = useAiBridge();
  useAiChoice();   // AI · 키를 바꾸면 대화 창(키 없음 안내 등)도 다시 그린다
  const [newId, setNewId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  // 새로 만들 id — 열 때 한 번(ai-flow-n, 겹치지 않게)
  useEffect(() => {
    if (!open || target || newId) return;
    void api.listFlows().then((fs) => { const taken = new Set(fs.map((f) => f.id)); let n = 1; while (taken.has(`ai-flow-${n}`)) n++; setNewId(`ai-flow-${n}`); }, () => setNewId(`ai-flow-${Date.now().toString(36)}`));
  }, [open, target, newId]);
  // Esc로 닫는다(입력 중이 아닐 때)
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLTextAreaElement)) aiBridge.open(false); };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [open]);
  if (!me.can("editor")) return null;

  const create = async (f: Flow) => {
    setError(null);
    try {
      const team = me.teams[0]?.id ?? null;
      const d = await api.createFlow(f, me.auth ? team : null);
      forgetSession("create");
      setNewId(null);
      setNonce((n) => n + 1);
      location.hash = `#/flows/${encodeURIComponent(d.id)}`;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      throw e;
    }
  };
  const key = target ? `flow:${target.flowId}` : `create:${nonce}`;

  return (
    <>
      {open && (
        <section className="ai-dock" role="dialog" aria-label="AI 어시스턴트">
          <header className="ai-dock-head">
            <button type="button" className="ai-dock-title" onClick={() => aiBridge.open(false)} title="접기">
              <span className="ai-dock-spark" aria-hidden="true">✦</span>
              <span className="grow">AI 어시스턴트<span className="ai-dock-sub">{target ? ` · «${target.draft.name}» 고치기` : " · 새 워크플로우"}</span></span>
              <IconChevronDown size={16} />
            </button>
            {!target && <button type="button" className="ai-dock-icon" title="새 대화" aria-label="새 대화" onClick={() => { forgetSession(key); setNonce((n) => n + 1); }}>＋</button>}
            <button type="button" className="ai-dock-icon" title="닫기" aria-label="AI 어시스턴트 닫기" onClick={() => aiBridge.open(false)}><IconX size={15} /></button>
          </header>
          <AiPicker />
          {error &&<div className="banner bad small ai-dock-error">{error}</div>}
          {target ? (
            <AiChat key={key} sessionKey={key} mode="edit" draft={target.draft} newId={target.flowId} flowId={target.flowId}
              onApply={(f) => target.apply(f)} onPreview={(f) => target.preview(f)} previewing={target.previewing}
              hints={["실패하면 Slack으로 알려 줘", "이 워크플로우가 무엇을 하는지 설명해 줘", "매일 아침 9시에 돌게 해 줘", "문제 목록을 고쳐 줘"]}
              placeholder="무엇을 바꿀까요?" />
          ) : newId ? (
            <AiChat key={key} sessionKey={key} mode="create" draft={null} newId={newId} flowId={null} onApply={create}
              hints={["매일 아침 9시에 쇼핑몰 관리자 화면에서 오늘 주문 목록을 읽어 엑셀로 메일 보내기", "주문 상태 페이지를 열어 '배송중'이 아니면 Slack으로 알리기", "로그인 화면이 잘 되는지 매일 검사하는 테스트"]}
              placeholder="무엇을 자동화할까요?" />
          ) : <div className="ai-body"><span className="spinner" /></div>}
        </section>
      )}
      <button type="button" className={`ai-fab${open ? " on" : ""}`} aria-label={open ? "AI 어시스턴트 닫기" : "AI 어시스턴트 열기"} aria-expanded={open} title="AI 어시스턴트" onClick={() => aiBridge.toggle()}>
        {open ? <IconX size={20} /> : <><span className="ai-fab-spark" aria-hidden="true">✦</span><span className="ai-fab-label">AI</span></>}
      </button>
    </>
  );
}
