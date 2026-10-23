/**
 * **새 플로우의 이름** — 빈 플로우를 만들면 캔버스로 바로 오고 이 창이 뜬다(FlowList → sessionStorage 표시 → FlowEditor).
 * 만들기 — 이름을 적고 저장한다 · 그만두기 — 방금 만든 빈 플로우를 지우고 목록으로 돌아간다(빈 플로우가 쌓이지 않게)
 */
import { useEffect, useRef, useState } from "react";

export const NEW_FLOW_KEY = "flowsmith:new-flow";

export function NameModal({ initial, onDone, onCancel }: { initial: string; onDone: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const ok = name.trim() !== "";
  return (
    <div className="modal-backdrop" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <form className="modal card name-modal" role="dialog" aria-label="새 워크플로우 이름" onSubmit={(e) => { e.preventDefault(); if (ok) onDone(name.trim()); }}>
        <h2>새 워크플로우</h2>
        <label className="field"><span>이름</span>
          <input ref={input} value={name} placeholder="주문 상태 확인" aria-label="워크플로우 이름" onChange={(e) => setName(e.target.value)} />
        </label>
        <span className="small muted">무엇을 하는 워크플로우인지 알아보기 쉽게 — 나중에 위쪽 이름 칸에서 바꿀 수 있습니다.</span>
        <div className="row"><span className="grow" />
          <button type="button" onClick={onCancel}>그만두기</button>
          <button className="primary" disabled={!ok}>만들기</button>
        </div>
      </form>
    </div>
  );
}
