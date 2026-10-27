/**
 * **캔버스** — 초안의 노드 · 엣지를 그린다 (@xyflow/react). n8n의 캔버스를 본떴다:
 *
 *   - 노드는 아이콘 타일 + 아래 이름 · 한 줄 부제. 자세한 건 오른쪽 서랍에서
 *   - 이어지지 않은 출력 점 옆에 ＋ — 누르면 다음 노드를 골라 바로 잇는다
 *   - 엣지에 올리면 ＋(사이에 끼우기) · 🗑(끊기)
 *   - 노드에 올리면 위에 도구 막대(설정 · 🗑 지우기) · 오른쪽 클릭 메뉴 · (여러 개를 끌어 고르고) Delete 키 — 지우기는 모두 onRemoveNodes 하나로(편집 화면이 «되돌리기»를 띄운다)
 *   - 조건 갈래 이름은 출력 점 바로 옆에(엣지 라벨로 겹치지 않게)
 *
 * 초안이 진실이다. 위치는 끌기가 끝날 때 초안에 적는다.
 * **메모**(n8n의 Sticky Note) — 노드 뒤에 깔리는 설명 상자. 위 띠를 잡아 옮기고 · 고르면 크기 · 색 · 지우기. 실행과 상관없다.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  applyEdgeChanges, applyNodeChanges, Background, BackgroundVariant, ConnectionLineType, BaseEdge, Controls, EdgeLabelRenderer, getSmoothStepPath, Handle, NodeResizer, Position,
  ReactFlow, ReactFlowProvider, useReactFlow,
  type Connection, type Edge as RFEdge, type EdgeChange, type EdgeProps, type Node as RFNode, type NodeChange, type NodeProps,
} from "@xyflow/react";
import { BLOCKED_PORT, NOTE_COLORS, type Flow, type FlowNode, type FlowNote, type NoteColor } from "@flowsmith/core";
import type { NodeStatus } from "../../api.ts";
import { canSplitStages, freeSpot, nextId, portsOf, reaches, stepNumbers, subtitleOf, type AddRequest } from "../../model/index.ts";
import { IconAlert, IconCheck, IconGear, IconNote, IconPlus, IconSkip, IconTrash, IconX } from "../../icons.tsx";
import { metaOf } from "../nodeMeta.tsx";

/** start — 들어오는 엣지가 없는 노드(n8n처럼 왼쪽이 둥글다) */
type Data = { node: FlowNode; no: number; status: NodeStatus | null; issues: string[]; connected: string[]; drift: "changed" | "broken" | null; start: boolean; pinned: boolean; ai: "added" | "changed" | null };
type FNode = RFNode<Data, "relay">;
type NNode = RFNode<{ note: FlowNote }, "note">;
type CNode = FNode | NNode;
/** 메모의 캔버스 id — 노드 id와 겹치지 않게(노드 id에는 «:»가 없다) */
const NOTE = "note:";
type EData = { running: boolean; done: boolean };
type FEdge = RFEdge<EData, "relay">;

interface Ctx {
  readOnly: boolean;
  requestAdd(req: AddRequest): void;
  removeEdge(id: string): void;
  removeNodes(ids: string[]): void;
  openNode(id: string): void;
  hoveredEdge: string | null;
  hoverEdge(id: string | null): void;
  updateNote(id: string, patch: Partial<FlowNote>): void;
  removeNote(id: string): void;
}
const CanvasCtx = createContext<Ctx>({ readOnly: true, requestAdd: () => {}, removeEdge: () => {}, removeNodes: () => {}, openNode: () => {}, hoveredEdge: null, hoverEdge: () => {}, updateNote: () => {}, removeNote: () => {} });

const NOTE_COLOR_LABEL: Record<NoteColor, string> = { yellow: "노랑", blue: "파랑", green: "초록", pink: "분홍", gray: "회색" };

function NoteNode({ data, selected }: NodeProps<NNode>) {
  const { readOnly, updateNote, removeNote } = useContext(CanvasCtx);
  const n = data.note;
  return (
    <div className={`canvas-note c-${n.color}${selected ? " selected" : ""}`}>
      {!readOnly && (
        <NodeResizer isVisible={selected} minWidth={140} minHeight={70} lineClassName="note-resize-line" handleClassName="note-resize-handle"
          onResizeEnd={(_, p) => updateNote(n.id, { width: Math.round(p.width), height: Math.round(p.height), position: { x: Math.round(p.x), y: Math.round(p.y) } })} />
      )}
      <div className="note-head" title={readOnly ? undefined : "잡아서 옮기기"}>
        <IconNote size={13} />
        {selected && !readOnly && (
          <span className="note-tools nodrag">
            {NOTE_COLORS.map((c) => <button key={c} className={`note-swatch c-${c}${c === n.color ? " on" : ""}`} title={NOTE_COLOR_LABEL[c]} onClick={() => updateNote(n.id, { color: c })} />)}
            <button className="note-del" title="메모 지우기" onClick={() => removeNote(n.id)}><IconTrash size={12} /></button>
          </span>
        )}
      </div>
      <NoteText id={n.id} text={n.text} readOnly={readOnly} onCommit={(text) => updateNote(n.id, { text })} />
    </div>
  );
}

/**
 * 메모 글 — 쓰는 동안은 제 글(local)이 진실이다. 한 글자마다 초안을 바꾸면 캔버스가 다시 그려지며 한글 조합(IME)이 끊긴다
 * («ㅎㅏ» → «하»가 안 된다). 조합 중에는 초안에 적지 않고 · 조합이 끝나거나 다른 데를 누르면 적는다. 쓰지 않을 때는 초안을 따른다(되돌리기 등).
 */
function NoteText({ id, text, readOnly, onCommit }: { id: string; text: string; readOnly: boolean; onCommit(text: string): void }) {
  const [local, setLocal] = useState(text);
  const editing = useRef(false);
  const composing = useRef(false);
  useEffect(() => { if (!editing.current) setLocal(text); }, [text, id]);
  const commit = (v: string) => { if (v !== text) onCommit(v); };
  return (
    <textarea className="nodrag nowheel" readOnly={readOnly} value={local} placeholder={readOnly ? "" : "메모 — 이 부분이 무엇을 하는지 적어 두세요"}
      onFocus={() => { editing.current = true; }}
      onBlur={(e) => { editing.current = false; composing.current = false; commit(e.target.value); }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(e) => { composing.current = false; commit(e.currentTarget.value); }}
      onChange={(e) => { setLocal(e.target.value); if (!composing.current) commit(e.target.value); }} />
  );
}

/** 공정 카드 — 가로 196 · 높이는 포트 수에 따라(최소 64). 새로 놓는 간격은 graph.ts의 GAP_X(260) */
const TILE = 64;
const CARD_W = 196;
const PORT_GAP = 30;

function StatusBadge({ status }: { status: NodeStatus | null }) {
  if (!status || status === "pending") return null;
  if (status === "running") return <span className="tile-badge running" title="도는 중" />;
  if (status === "succeeded") return <span className="tile-badge ok" title="성공"><IconCheck size={13} strokeWidth={2.6} /></span>;
  if (status === "failed") return <span className="tile-badge bad" title="실패"><IconX size={13} strokeWidth={2.6} /></span>;
  if (status === "blocked") return <span className="tile-badge blocked" title="막힘 — 고르면 안 되는 건이라 멈췄습니다">!</span>;
  return <span className="tile-badge skip" title={status === "skipped" ? "건너뜀" : "안 돎"}><IconSkip size={13} strokeWidth={2.6} /></span>;
}

function RelayNode({ data, selected }: NodeProps<FNode>) {
  const { node, no, status, issues, connected, drift, start, pinned, ai } = data;
  const { readOnly, requestAdd, removeNodes, openNode } = useContext(CanvasCtx);
  const meta = metaOf(node);
  const Icon = meta.icon;
  const ports: { id: string; label: string; end: string | null }[] = node.type === "condition"
    ? [
        ...node.config.cases.map((c) => ({ id: c.id, label: c.label || c.id, end: c.then.kind === "end" ? (c.then.status === "success" ? "종료 · 성공" : "종료 · 실패") : null })),
        { id: "else", label: "그 밖", end: node.config.else.then.kind === "end" ? (node.config.else.then.status === "success" ? "종료 · 성공" : "종료 · 실패") : null },
      ]
    : portsOf(node).map((p) => ({ ...p, end: null }));
  const height = Math.max(TILE, ports.length * PORT_GAP + 16);
  const topOf = (i: number) => (ports.length === 1 ? height / 2 : 8 + PORT_GAP / 2 + i * PORT_GAP + (height - 16 - ports.length * PORT_GAP) / 2);

  return (
    <div className={`relay-node ${meta.cls}${start ? " is-start" : ""}${selected ? " selected" : ""}${status ? ` st-${status}` : ""}${ai ? ` ai-${ai}` : ""}`}>
      {/* 올리면 · 고르면 위에 — n8n처럼(지우기를 찾기 쉽게) */}
      {!readOnly && (
        <div className="tile-tools nodrag" onClick={(e) => e.stopPropagation()}>
          <button title="설정 열기" aria-label="설정 열기" onClick={() => openNode(node.id)}><IconGear size={14} /></button>
          <button className="danger" title="노드 지우기" aria-label="노드 지우기" onClick={() => removeNodes([node.id])}><IconTrash size={14} /></button>
        </div>
      )}
      <div className="tile" style={{ height }}>
        <Handle type="target" position={Position.Left} id="in" />
        <span className="tile-icon"><Icon size={22} strokeWidth={1.8} /></span>
        <div className="tile-body">
          <div className="tile-kicker"><span className="tile-no">{String(no).padStart(2, "0")}</span>{start ? "시작 · " : ""}{meta.title}</div>
          <div className="tile-name" title={node.name}>{node.name}</div>
          <div className="tile-sub">{subtitleOf(node)}</div>
        </div>
        <StatusBadge status={status} />
        {drift && <span className={`tile-drift ${drift}`} title={drift === "broken" ? "변경 감시: 요소를 못 찾습니다" : "변경 감시: 요소가 바뀌었습니다"}>{drift === "broken" ? "깨짐" : "바뀜"}</span>}
        {issues.length > 0 && <span className="tile-issue" title={issues.join("\n")}><IconAlert size={15} strokeWidth={2.2} /></span>}
        {pinned && <span className="tile-pin" title="출력이 고정돼 있습니다 — 초안 시험에서 이 노드는 돌지 않습니다">📌</span>}
        {ports.map((p, i) => (
          <div key={p.id} className="port" style={{ top: topOf(i) }}>
            {p.end === null && <Handle type="source" position={Position.Right} id={p.id} style={{ top: 0 }} />}
            {/* 갈래 이름은 짧게 — 카드 사이(64)를 넘으면 옆 카드 밑으로 겹친다. 전체 문구는 툴팁에 */}
            {node.type === "condition" && (
              <span className={`port-label${p.end ? " end" : ""}`} title={p.end ? `${p.label} → ${p.end}` : p.label}>{p.label}</span>
            )}
            {/* 끝나는 갈래 — 선 끝에 종료 원(◉). 노드가 아니라 카드에 붙은 그림이라 끌면 같이 움직인다 */}
            {p.end && (
              <span className={`port-terminal${p.end.endsWith("실패") ? " fail" : ""}`} title={p.end}>
                <span className="stub" /><span className="terminal-dot" />
              </span>
            )}
            {node.type !== "condition" && p.id === BLOCKED_PORT && (
              <span className="port-label blocked" title="고르면 안 되는 행에 걸리면 이쪽으로 갑니다 — 잇지 않으면 그 자리에서 멈춥니다(실패)">
                {p.label}{connected.includes(p.id) ? "" : " → 멈춤"}
              </span>
            )}
            {p.end === null && !connected.includes(p.id) && !readOnly && (
              <span className={`port-add${node.type === "condition" || p.id === BLOCKED_PORT ? " with-label" : ""}`}>
                <span className="stub" />
                <button className="nodrag" title="다음 단계 더하기" onClick={(e) => { e.stopPropagation(); requestAdd({ kind: "after", node: node.id, port: p.id }); }}>
                  <IconPlus size={13} strokeWidth={2.4} />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RelayEdge(props: EdgeProps<FEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected, data } = props;
  const { readOnly, requestAdd, removeEdge, hoveredEdge, hoverEdge } = useContext(CanvasCtx);
  // 직각 · 둥근 모서리(작업대) — 곡선(베지어)은 n8n의 얼굴이었다. offset은 포트에서 꺾이기 전까지 곧게 나가는 길이
  const [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10, offset: 18 });
  const show = !readOnly && (hoveredEdge === id || selected);
  const cls = data?.running ? "running" : data?.done ? "done" : "";
  return (
    <>
      <BaseEdge id={id} path={path} {...(markerEnd ? { markerEnd } : {})} className={`relay-edge ${cls}${selected ? " selected" : ""}`} interactionWidth={24} />
      {show && (
        <EdgeLabelRenderer>
          <div className="edge-tools nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
            onMouseEnter={() => hoverEdge(id)} onMouseLeave={() => hoverEdge(null)}>
            <button title="사이에 노드 끼우기" onClick={() => requestAdd({ kind: "between", edge: id })}><IconPlus size={13} strokeWidth={2.4} /></button>
            <button title="연결 끊기" onClick={() => removeEdge(id)}><IconTrash size={13} /></button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { relay: RelayNode, note: NoteNode };
const edgeTypes = { relay: RelayEdge };

export interface CanvasProps {
  flow: Flow;
  selected: string | null;
  statuses: Record<string, NodeStatus>;
  issues: Map<string, string[]>;
  /** 변경 감시 — 노드마다 가장 나쁜 것 */
  drift?: Map<string, "changed" | "broken">;
  /** 출력이 고정된 노드들 */
  pinned?: Set<string>;
  /** AI 제안 미리 보기 — 더한 · 바뀐 노드(ai/AiChat.tsx nodeChanges) */
  aiMarks?: Map<string, "added" | "changed">;
  readOnly?: boolean;
  onSelect(id: string | null): void;
  onChange(fn: (f: Flow) => Flow): void;
  onRequestAdd(req: AddRequest): void;
  onToast(text: string): void;
  /** 노드 지우기 — 도구 막대 · 오른쪽 클릭 · Delete 키가 모두 이리로. 없으면 캔버스가 초안에서 바로 지운다 */
  onRemoveNodes?(ids: string[]): void;
  /** 웹페이지 노드를 사람 기다리기마다 나눈다(오른쪽 클릭 메뉴) */
  onSplitStages?(id: string): void;
  /** 캔버스 위에 띄울 것 — 실행 버튼 등 */
  children?: ReactNode;
}

function Inner({ flow, selected, statuses, issues, drift, pinned, aiMarks, readOnly = false, onSelect, onChange, onRequestAdd, onToast, onRemoveNodes, onSplitStages, children }: CanvasProps) {
  /** 오른쪽 클릭 메뉴 — 캔버스 안 자리 */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const rf = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<CNode[]>([]);
  const [edges, setEdges] = useState<FEdge[]>([]);
  const [hoveredEdge, setHovered] = useState<string | null>(null);
  const leave = useRef<number | undefined>(undefined);

  const hoverEdge = useCallback((id: string | null) => {
    clearTimeout(leave.current);
    if (id) setHovered(id);
    else leave.current = window.setTimeout(() => setHovered(null), 220);  // 엣지에서 도구로 옮겨 가는 틈
  }, []);

  useEffect(() => {
    const connected = new Map<string, string[]>();
    for (const e of flow.edges) connected.set(e.from.node, [...(connected.get(e.from.node) ?? []), e.from.port]);
    const targets = new Set(flow.edges.map((e) => e.to.node));
    const nos = stepNumbers(flow);
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      // 메모 — 노드 뒤에 깔린다(zIndex). 고른 것은 캔버스가 기억한다(오른쪽 서랍과 상관없다)
      const notes = (flow.notes ?? []).map((n): NNode => {
        const o = old.get(NOTE + n.id);
        return {
          id: NOTE + n.id, type: "note", position: o?.dragging ? o.position : n.position, width: n.width, height: n.height, zIndex: -1,
          selected: o?.selected ?? false, draggable: !readOnly, dragHandle: ".note-head", data: { note: n },
        };
      });
      return [...notes, ...flow.nodes.map((n): FNode => {
        const o = old.get(n.id);
        return {
          ...(o ?? {}),
          id: n.id, type: "relay",
          position: o?.dragging ? o.position : n.position,
          selected: n.id === selected,
          draggable: !readOnly,
          data: { node: n, no: nos.get(n.id) ?? 0, status: statuses[n.id] ?? null, issues: issues.get(n.id) ?? [], connected: connected.get(n.id) ?? [], drift: drift?.get(n.id) ?? null, start: !targets.has(n.id), pinned: pinned?.has(n.id) ?? false, ai: aiMarks?.get(n.id) ?? null },
        } as FNode;
      })];
    });
  }, [flow.nodes, flow.notes, flow.edges, selected, statuses, issues, drift, pinned, aiMarks, readOnly]);

  useEffect(() => {
    setEdges((prev) => {
      const sel = new Set(prev.filter((e) => e.selected).map((e) => e.id));
      return flow.edges.map((e): FEdge => ({
        id: e.id, type: "relay", source: e.from.node, sourceHandle: e.from.port, target: e.to.node, targetHandle: "in",
        selected: sel.has(e.id),
        data: {
          running: statuses[e.to.node] === "running",
          done: statuses[e.from.node] === "succeeded" && (statuses[e.to.node] === "succeeded" || statuses[e.to.node] === "failed"),
        },
      }));
    });
  }, [flow.edges, statuses]);

  const removeEdge = useCallback((id: string) => onChange((f) => ({ ...f, edges: f.edges.filter((e) => e.id !== id) })), [onChange]);
  // AI 제안 미리 보기를 켜면 — 더한 노드가 화면 밖일 수 있다 · 다 보이게 맞춘다
  const previewing = aiMarks !== undefined;
  useEffect(() => { if (previewing) { const t = setTimeout(() => void rf.fitView({ padding: 0.25, duration: 300 }), 60); return () => clearTimeout(t); } return undefined; }, [previewing, rf]);
  // ★ref로 — onNodesChange(Delete 키)가 늘 지금의 것을 부르게
  const removeRef = useRef<(ids: string[]) => void>(() => undefined);
  removeRef.current = (ids: string[]) => {
    if (readOnly || ids.length === 0) return;
    if (onRemoveNodes) { onRemoveNodes(ids); return; }
    onChange((f) => ({ ...f, nodes: f.nodes.filter((n) => !ids.includes(n.id)), edges: f.edges.filter((e) => !ids.includes(e.from.node) && !ids.includes(e.to.node)) }));
    if (selected && ids.includes(selected)) onSelect(null);
  };
  const removeNodes = useCallback((ids: string[]) => removeRef.current(ids), []);
  const openNode = useCallback((id: string) => onSelect(id), [onSelect]);
  // 메뉴 — 바깥을 누르거나 Esc면 닫는다
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element | null)?.closest?.(".canvas-menu")) setMenu(null); };
    addEventListener("mousedown", close);
    addEventListener("keydown", close);
    return () => { removeEventListener("mousedown", close); removeEventListener("keydown", close); };
  }, [menu]);

  const updateNote = useCallback((id: string, patch: Partial<FlowNote>) => onChange((f) => ({ ...f, notes: (f.notes ?? []).map((n) => (n.id === id ? { ...n, ...patch } : n)) })), [onChange]);
  const removeNote = useCallback((id: string) => onChange((f) => ({ ...f, notes: (f.notes ?? []).filter((n) => n.id !== id) })), [onChange]);

  const onNodesChange = useCallback((changes: NodeChange<CNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    if (readOnly) return;
    const gone = changes.filter((c) => c.type === "remove").map((c) => c.id);
    const notesGone = gone.filter((id) => id.startsWith(NOTE)).map((id) => id.slice(NOTE.length));
    if (notesGone.length) onChange((f) => ({ ...f, notes: (f.notes ?? []).filter((n) => !notesGone.includes(n.id)) }));
    const removed = gone.filter((id) => !id.startsWith(NOTE));
    if (removed.length) removeNodes(removed);
  }, [onChange, readOnly]);

  const onEdgesChange = useCallback((changes: EdgeChange<FEdge>[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
    if (readOnly) return;
    const removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
    if (removed.length) onChange((f) => ({ ...f, edges: f.edges.filter((e) => !removed.includes(e.id)) }));
  }, [onChange, readOnly]);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || !c.sourceHandle) return;
    if (c.source === c.target) return onToast("노드를 자기 자신에게 이을 수 없습니다");
    if (reaches(flow, c.target, c.source)) return onToast("이으면 순환이 생깁니다 — 워크플로우는 되돌아갈 수 없습니다");
    if (flow.edges.some((e) => e.from.node === c.source && e.from.port === c.sourceHandle && e.to.node === c.target)) return;
    onChange((f) => ({ ...f, edges: [...f.edges, { id: nextId("e", f.edges.map((e) => e.id)), from: { node: c.source, port: c.sourceHandle! }, to: { node: c.target } }] }));
  }, [flow, onChange, onToast]);

  const centerAdd = useCallback(() => {
    const box = wrap.current?.getBoundingClientRect();
    const p = rf.screenToFlowPosition({ x: (box?.left ?? 0) + (box?.width ?? 800) / 2, y: (box?.top ?? 0) + (box?.height ?? 600) / 2 });
    onRequestAdd({ kind: "at", position: { x: p.x - CARD_W / 2, y: p.y - TILE / 2 } });
  }, [rf, onRequestAdd]);

  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && nodes.length > 0) { fitted.current = true; requestAnimationFrame(() => rf.fitView({ padding: 0.35, maxZoom: 1.1 })); }
  }, [nodes.length, rf]);

  const ctx = useMemo<Ctx>(() => ({ readOnly, requestAdd: onRequestAdd, removeEdge, removeNodes, openNode, hoveredEdge, hoverEdge, updateNote, removeNote }), [readOnly, onRequestAdd, removeEdge, removeNodes, openNode, hoveredEdge, hoverEdge, updateNote, removeNote]);

  /** 메모 더하기 — 화면 가운데에서 가까운, 노드 · 다른 메모와 겹치지 않는 자리에(model/place.ts) */
  const addNote = useCallback(() => {
    const box = wrap.current?.getBoundingClientRect();
    const tl = rf.screenToFlowPosition({ x: box?.left ?? 0, y: box?.top ?? 0 });
    const br = rf.screenToFlowPosition({ x: (box?.left ?? 0) + (box?.width ?? 800), y: (box?.top ?? 0) + (box?.height ?? 600) });
    const taken = rf.getNodes().map((n) => ({ x: n.position.x, y: n.position.y, width: n.measured?.width ?? n.width ?? CARD_W, height: n.measured?.height ?? n.height ?? TILE }));
    const size = { width: 260, height: 140 };
    const at = freeSpot(taken, size, { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y });
    onChange((f) => ({ ...f, notes: [...(f.notes ?? []), { id: nextId("m", (f.notes ?? []).map((n) => n.id)), text: "", position: { x: at.x, y: at.y }, ...size, color: "yellow" }] }));
    // 화면에 빈자리가 없었다 — 메모가 놓인 곳으로 옮겨 보여 준다
    if (!at.inView) void rf.setCenter(at.x + size.width / 2, at.y + size.height / 2, { zoom: rf.getZoom(), duration: 300 });
  }, [rf, onChange]);

  return (
    <CanvasCtx.Provider value={ctx}>
      <div className="canvas" ref={wrap}>
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          onNodeClick={(_, n) => onSelect(n.type === "note" ? null : n.id)}
          onNodeDragStop={(_, n) => {
            const pos = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
            if (n.type === "note") updateNote(n.id.slice(NOTE.length), { position: pos });
            else onChange((f) => ({ ...f, nodes: f.nodes.map((x) => x.id === n.id ? { ...x, position: pos } : x) }));
          }}
          onEdgeMouseEnter={(_, e) => hoverEdge(e.id)}
          onEdgeMouseLeave={() => hoverEdge(null)}
          onPaneClick={() => { onSelect(null); setMenu(null); }}
          onNodeContextMenu={(e, n) => {
            if (readOnly || n.type === "note") return;
            e.preventDefault();
            const box = wrap.current?.getBoundingClientRect();
            setMenu({ id: n.id, x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) });
          }}
          nodesConnectable={!readOnly}
          deleteKeyCode={readOnly ? null : ["Delete", "Backspace"]}
          snapToGrid snapGrid={[24, 24]}
          minZoom={0.25} maxZoom={2}
          defaultEdgeOptions={{ type: "relay" }}
          connectionLineType={ConnectionLineType.SmoothStep}
          connectionRadius={36}
        >
          {/* 모눈 — 작은 칸 24 · 큰 칸 120(점 무늬 대신) */}
          <Background id="minor" variant={BackgroundVariant.Lines} gap={24} lineWidth={1} color="var(--grid-minor)" />
          <Background id="major" variant={BackgroundVariant.Lines} gap={120} lineWidth={1} color="var(--grid-major)" />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
        {menu && (
          <div className="menu canvas-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
            <button className="menu-item" role="menuitem" onClick={() => { onSelect(menu.id); setMenu(null); }}>설정 열기</button>
            {onSplitStages && (() => { const n = flow.nodes.find((x) => x.id === menu.id); return n && canSplitStages(n); })() && (
              <button className="menu-item" role="menuitem" title="사람 기다리기마다 노드를 나눕니다 — 페이지 접속 → 사람 기다리기 → 그 뒤 동작" onClick={() => { onSplitStages(menu.id); setMenu(null); }}>단계별로 나누기</button>
            )}
            <button className="menu-item danger" role="menuitem" onClick={() => { removeNodes([menu.id]); setMenu(null); }}>노드 지우기</button>
          </div>
        )}
        {!readOnly && (
          <div className="canvas-tools">
            <button className="icon-btn raised" title="노드 더하기 (Tab)" onClick={centerAdd}><IconPlus size={18} /></button>
            <button className="icon-btn raised" title="메모 더하기 — 워크플로우에 설명을 남깁니다(실행과 상관없음)" onClick={addNote}><IconNote size={18} /></button>
          </div>
        )}
        {flow.nodes.length === 0 && !readOnly && (
          <div className="first-step">
            <button className="first-step-main" onClick={centerAdd}>
              <span className="first-step-plus"><IconPlus size={28} /></span>
              <span className="first-step-title">첫 단계 더하기</span>
            </button>
            <span className="first-step-hint">보통은 «웹페이지»로 시작합니다 — 페이지를 띄워 한 번 해 보이면 녹화됩니다</span>
            <a className="first-step-link" href="#/templates">또는 템플릿에서 시작하기 →</a>
          </div>
        )}
        {children}
      </div>
    </CanvasCtx.Provider>
  );
}

export function Canvas(props: CanvasProps) {
  return <ReactFlowProvider><Inner {...props} /></ReactFlowProvider>;
}
