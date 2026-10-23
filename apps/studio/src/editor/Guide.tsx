/**
 * **다음 할 일** — 플로우가 «혼자 돌 수 있게» 되기까지 남은 일을 차례로 보여 준다(PLAN §18).
 * ★저장하지 않는다 — 언제나 지금 초안 · 실행 기록 · 게시 상태에서 계산한다(템플릿이든 빈 플로우든 같다).
 *  다 하면 사라진다. 사람이 접어 둘 수도 있다(이 브라우저에만 기억).
 */
import { useState } from "react";
import type { GuideItem } from "../model/guide.ts";
export { guideItems, type GuideItem, type GuideActions } from "../model/guide.ts";
import { IconCheck, IconChevronDown, IconChevronUp, IconX } from "../icons.tsx";
import { recall, remember } from "../shell/remember.ts";

const KEY = (id: string) => `flowsmith-guide:${id}`;
/** 따로 고르지 않았으면 — 넓은 화면은 펼쳐서, 좁은 화면(폰)은 접어서(캔버스를 가리지 않게) */
const narrow = () => typeof window !== "undefined" && window.innerWidth < 640;
const read = (id: string): "open" | "folded" | "hidden" => (recall(KEY(id)) as "open" | "folded" | "hidden" | null) ?? (narrow() ? "folded" : "open");
const write = (id: string, v: string) => remember(KEY(id), v);

export function Guide({ flowId, items }: { flowId: string; items: GuideItem[] }) {
  const [state, setState] = useState(() => read(flowId));
  const left = items.filter((i) => !i.done);
  if (left.length === 0 || state === "hidden") return null;
  const set = (v: "open" | "folded" | "hidden") => { setState(v); write(flowId, v); };
  const next = left[0]!;
  return (
    <div className="guide">
      <div className="guide-head">
        <b className="grow">다음 할 일 <span className="muted">{items.length - left.length}/{items.length}</span></b>
        <button className="icon-btn" title={state === "folded" ? "펼치기" : "접기"} onClick={() => set(state === "folded" ? "open" : "folded")}>{state === "folded" ? <IconChevronDown size={14} /> : <IconChevronUp size={14} />}</button>
        <button className="icon-btn" title="다시 보지 않기(이 워크플로우)" onClick={() => set("hidden")}><IconX size={14} /></button>
      </div>
      {state === "folded" ? (
        <div className="guide-item next"><span className="guide-dot" /><span className="grow">{next.text}</span>{next.action && <button className="small primary" onClick={next.action.run}>{next.action.label}</button>}</div>
      ) : items.map((i) => (
        <div key={i.id} className={`guide-item${i.done ? " done" : ""}${i === next ? " next" : ""}`}>
          {i.done ? <span className="guide-dot ok"><IconCheck size={10} strokeWidth={3} /></span> : <span className="guide-dot" />}
          <span className="grow">{i.text}</span>
          {!i.done && i.action && <button className={`small${i === next ? " primary" : ""}`} onClick={i.action.run}>{i.action.label}</button>}
        </div>
      ))}
    </div>
  );
}
