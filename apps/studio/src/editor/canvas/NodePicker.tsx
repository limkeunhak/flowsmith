/**
 * 노드 고르기 — n8n의 노드 창처럼 오른쪽에서 열린다. 무리(웹에서 · 값과 파일 · 흐름 · 다른 시스템 · 고급)로 나눠 보이고,
 * 찾는 말을 넣으면 무리 없이 맞는 것만. 출력 점의 ＋ · 엣지 위 ＋ · 캔버스 ＋ · Tab 키가 모두 여기로 온다.
 * ☆워커에 설치된 **확장**(예: 사내 주문 시스템 읽기)도 «다른 시스템»에 보인다 — 서버가 알려 준 목록이다.
 */
import { useEffect, useRef, useState } from "react";
import type { NodeType } from "@flowsmith/core";
import { listExtensions, type ExtensionMeta } from "../../api.ts";
import type { NodeChoice } from "../../model/index.ts";
import { IconSearch, IconX, NodeIconExt } from "../../icons.tsx";
import { HUMAN_META, NODE_GROUPS, NODE_META } from "../nodeMeta.tsx";

export { NODE_META } from "../nodeMeta.tsx";

const BASIC: Exclude<NodeType, "extension">[] = ["web", "transform", "fileWrite", "fileRead", "zip", "condition", "flowCall", "http", "custom"];
/** 웹에서 무리에 함께 — 사람 기다리기(속은 웹페이지 노드 · model/nodes.ts newNode("human")) */
const showHuman = (hit: (t: string) => boolean) => hit(`${HUMAN_META.title} ${HUMAN_META.desc} ${HUMAN_META.keywords}`);

export function NodePicker({ title, onPick, onClose }: { title: string; onPick: (c: NodeChoice) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [exts, setExts] = useState<ExtensionMeta[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); void listExtensions().then(setExts); }, []);
  const searching = q.trim() !== "";
  const hit = (text: string) => !searching || text.toLowerCase().includes(q.trim().toLowerCase());
  const types = BASIC.filter((t) => hit(`${NODE_META[t].title} ${NODE_META[t].desc} ${NODE_META[t].keywords}`));
  const shownExts = exts.filter((e) => hit(`${e.title} ${e.description} ${e.id} 확장`));
  const human = showHuman(hit);
  const first: NodeChoice | undefined = types[0] ?? (human ? "human" : undefined) ?? shownExts[0];
  const humanItem = (
    <button key="human" className="picker-item" onClick={() => onPick("human")}>
      <span className="picker-icon t-human"><HUMAN_META.icon size={24} /></span>
      <span className="grow">
        <span className="picker-title">{HUMAN_META.title}</span>
        <span className="picker-desc">{HUMAN_META.desc}</span>
      </span>
    </button>
  );

  const typeItem = (t: Exclude<NodeType, "extension">) => {
    const m = NODE_META[t];
    const Icon = m.icon;
    return (
      <button key={t} className="picker-item" onClick={() => onPick(t)}>
        <span className={`picker-icon t-${t}`}><Icon size={24} /></span>
        <span className="grow">
          <span className="picker-title">{m.title}</span>
          <span className="picker-desc">{m.desc}</span>
        </span>
      </button>
    );
  };
  const extItem = (e: ExtensionMeta) => (
    <button key={e.id} className="picker-item" onClick={() => onPick(e)}>
      <span className="picker-icon t-extension"><NodeIconExt size={24} /></span>
      <span className="grow">
        <span className="picker-title">{e.title}{e.risk === "unsafe" && <span className="pill warn" style={{ marginLeft: 6 }}>되돌릴 수 없음</span>}</span>
        <span className="picker-desc">{e.description}</span>
      </span>
    </button>
  );

  return (
    <div className="drawer-inner" onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter" && first) onPick(first); }}>
      <div className="drawer-head">
        <h2 className="grow">{title}</h2>
        <button className="icon-btn" title="닫기 (Esc)" onClick={onClose}><IconX /></button>
      </div>
      <div className="drawer-body stack">
        <label className="search">
          <IconSearch />
          <input ref={input} placeholder="무엇을 할까요? — 예: 엑셀, 거르기, 슬랙" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {searching ? (
          <div className="picker-list">
            {types.map(typeItem)}
            {human && humanItem}
            {shownExts.map(extItem)}
          </div>
        ) : NODE_GROUPS.map((g) => {
          const inGroup = types.filter((t) => NODE_META[t].group === g.id);
          const ex = g.id === "connect" ? shownExts : [];
          if (inGroup.length === 0 && ex.length === 0) return null;
          return (
            <div key={g.id} className="picker-group">
              <h3>{g.title}</h3>
              <div className="picker-list">
                {inGroup.map(typeItem)}
                {g.id === "web" && humanItem}
                {ex.map(extItem)}
              </div>
            </div>
          );
        })}
        {types.length === 0 && !human && shownExts.length === 0 &&<div className="empty small">맞는 노드가 없습니다 — 다른 말로 찾아보세요</div>}
      </div>
    </div>
  );
}
