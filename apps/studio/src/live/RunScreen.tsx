/**
 * **실행 화면 보기** — 돌고 있는 실행의 실제 브라우저 화면.
 * 열 때만 서버가 화면을 보내기 시작하고, 닫으면 멈춘다. 캡처는 남기지 않는다.
 *
 * ★평소에는 보기만 한다. 실행이 **사람을 기다리는 동안**(사람 기다리기 — 로그인 · 인증)만, 실행자 이상이면 이 화면을 눌러 직접 한다.
 *  입력은 서버가 그 페이지로 넘길 뿐 남기지 않는다(비밀번호가 지나간다). 키 · 한글 입력은 라이브 페이지(LiveView)와 같은 방식이다.
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import { IconX } from "../icons.tsx";

type Msg =
  | { t: "page"; url: string; title: string }
  | { t: "viewport"; width: number; height: number }
  | { t: "wait"; message: string }
  | { t: "end"; status: string; message: string }
  | { t: "human"; prompt: string | null; deadline: string | null; control: boolean };

const BUTTON = ["left", "middle", "right"] as const;

/** 남은 시간 — 「4:32」 */
export function leftText(deadline: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((Date.parse(deadline) - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function RunScreen({ runId, title, step, onClose }: { runId: string; title: string; step?: string; onClose: () => void }) {
  const [frame, setFrame] = useState<string | null>(null);
  const [page, setPage] = useState<{ url: string; title: string } | null>(null);
  const [note, setNote] = useState("연결하는 중…");
  const [ended, setEnded] = useState<{ status: string; message: string } | null>(null);
  const [human, setHuman] = useState<{ prompt: string; deadline: string | null; control: boolean } | null>(null);
  const [, tick] = useState(0);
  /** 페이지 크기(CSS px) — 서버가 알려 준다. 모르면 그림의 실제 크기로(화면 전송은 크기 그대로 보낸다 — 1600 넘으면 줄인다) */
  const viewport = useRef<{ width: number; height: number } | null>(null);
  /** 누른 자리 — 사람이 «눌렸나»를 보게 잠깐 동그라미 */
  const [ping, setPing] = useState<{ x: number; y: number; id: number } | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const keys = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const lastMove = useRef(0);

  useEffect(() => {
    const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/runs/${encodeURIComponent(runId)}/screen`);
    ws.current = sock;
    sock.binaryType = "blob";
    let last: string | null = null;
    sock.onmessage = (e) => {
      if (e.data instanceof Blob) {
        const url = URL.createObjectURL(e.data);
        if (last) URL.revokeObjectURL(last);
        last = url;
        setFrame(url);
        setNote("");
        return;
      }
      const m = JSON.parse(String(e.data)) as Msg;
      if (m.t === "page") setPage({ url: m.url, title: m.title });
      if (m.t === "viewport") viewport.current = { width: m.width, height: m.height };
      if (m.t === "wait") setNote(m.message);
      if (m.t === "end") { setEnded({ status: m.status, message: m.message }); setHuman(null); }
      if (m.t === "human") setHuman(m.prompt === null ? null : { prompt: m.prompt, deadline: m.deadline, control: m.control });
    };
    sock.onclose = () => setNote((n) => n || "");
    return () => { sock.close(); ws.current = null; if (last) URL.revokeObjectURL(last); };
  }, [runId]);

  // 남은 시간 — 1초마다 다시 그린다(기다리는 동안만)
  useEffect(() => {
    if (!human?.deadline) return;
    const t = window.setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [human?.deadline]);

  const control = human?.control === true && !ended;
  const send = (m: unknown) => { if (control && ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m)); };
  /** 화면 위의 자리 → 페이지 좌표(그림은 줄여 보이니 실제 크기로 되돌린다) */
  const pos = (e: { clientX: number; clientY: number }) => {
    const el = img.current!;
    const r = el.getBoundingClientRect();
    const size = viewport.current ?? { width: el.naturalWidth || r.width, height: el.naturalHeight || r.height };
    return { x: Math.round(((e.clientX - r.left) / r.width) * size.width), y: Math.round(((e.clientY - r.top) / r.height) * size.height) };
  };
  const mouse = (type: "down" | "up" | "move") => (e: MouseEvent<HTMLImageElement>) => {
    if (!control) return;
    if (type === "move") {
      const now = performance.now();
      if (now - lastMove.current < 33) return;
      lastMove.current = now;
    }
    if (type === "down") {
      e.preventDefault();
      keys.current?.focus({ preventScroll: true });
      const r = e.currentTarget.getBoundingClientRect();
      setPing({ x: e.clientX - r.left, y: e.clientY - r.top, id: Date.now() });
    }
    send({ t: "mouse", type, ...pos(e), button: type === "move" ? "left" : BUTTON[e.button] ?? "left", clickCount: type === "move" ? 0 : e.detail || 1 });
  };
  const onWheel = (e: WheelEvent<HTMLImageElement>) => { if (control) send({ t: "wheel", ...pos(e), dx: e.deltaX, dy: e.deltaY }); };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || composing.current || e.key === "Process" || e.key === "Unidentified") return;
    if (e.key.length > 1 || e.ctrlKey || e.metaKey || e.altKey) { e.preventDefault(); send({ t: "key", type: "down", key: e.key }); }
  };
  const onKeyUp = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || composing.current) return;
    if (e.key.length > 1 || e.ctrlKey || e.metaKey || e.altKey) send({ t: "key", type: "up", key: e.key });
  };
  const onInput = (e: FormEvent<HTMLTextAreaElement>) => {
    if (composing.current) return;
    const t = e.currentTarget.value;
    if (t) send({ t: "text", text: t });
    e.currentTarget.value = "";
  };

  return (
    <div className="screen-modal" onClick={onClose}>
      <div className="screen-box" onClick={(e) => e.stopPropagation()}>
        <div className="screen-head">
          <span className={`dot ${ended ? "" : "running"}`} />
          <strong className="grow">실행 화면 · {title}</strong>
          <span className="small muted">{control ? "지금은 이 화면을 눌러 직접 할 수 있습니다" : human ? "사람을 기다리는 중 — 실행자만 누를 수 있습니다" : "보기만 합니다 — 누르거나 칠 수 없습니다"}</span>
          <button className="icon-btn" title="닫기 — 화면 보내기를 멈춥니다(기다림은 그대로입니다)" onClick={onClose}><IconX /></button>
        </div>
        {human && (
          <div className="banner warn screen-human" role="status">
            <b>🙋 {human.prompt}</b>
            <span>{control ? "아래 화면에서 직접 하세요. 끝나면 실행이 저절로 이어 갑니다." : "이 실행이 사람을 기다립니다."}{human.deadline ? ` · ${leftText(human.deadline)} 남음` : ""}</span>
            {control && <span className="small">입력한 내용은 녹화하지도 기록하지도 않습니다.</span>}
          </div>
        )}
        <div className="screen-url mono small">{page ? page.url : "—"}{step ? <span className="muted"> · {step}</span> : null}</div>
        <div className={`screen-stage${control ? " control" : ""}`}>
          {frame ? (
            <img ref={img} src={frame} alt="실행 중인 브라우저 화면" draggable={false}
              onMouseDown={mouse("down")} onMouseUp={mouse("up")} onMouseMove={mouse("move")} onWheel={onWheel} onContextMenu={(e) => { if (control) e.preventDefault(); }} />
          ) : <div className="muted small">{note || "화면을 기다리는 중…"}</div>}
          {control && ping && frame && <span key={ping.id} className="screen-ping" style={{ left: (img.current?.offsetLeft ?? 0) + ping.x, top: (img.current?.offsetTop ?? 0) + ping.y }} onAnimationEnd={() => setPing(null)} />}
          {control && (
            <textarea ref={keys} className="live-keys" aria-label="실행 화면 키보드" autoCapitalize="off" autoComplete="off" spellCheck={false}
              onKeyDown={onKeyDown} onKeyUp={onKeyUp} onInput={onInput}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={(e) => { composing.current = false; if (e.data) send({ t: "text", text: e.data }); e.currentTarget.value = ""; }} />
          )}
          {ended && (
            <div className={`screen-ended banner ${ended.status === "success" ? "info" : "bad"} small`}>
              실행이 끝났습니다{ended.status === "success" ? "" : ` — ${ended.message || "실패"}`}{frame ? " · 마지막 화면입니다" : ""}
            </div>
          )}
        </div>
        <div className="small muted">사람의 크롬에 붙는 워크플로우는 그 크롬 창에서, 앱 안 브라우저는 앞으로 나온 실행 창에서 직접 하는 것이 빠릅니다. 창이 가려져 있으면 화면이 늦게 올 수 있습니다.</div>
      </div>
    </div>
  );
}
