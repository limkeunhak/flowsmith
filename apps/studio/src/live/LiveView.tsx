/**
 * **라이브 페이지** — 서버 Chromium의 화면을 그리고, 사람의 손을 서버로 넘긴다 (결정 1의 A).
 *
 * ★한글 입력: 캔버스는 글자를 못 받는다. 보이지 않는 textarea에 포커스를 두고 IME 조합이 **끝난 글자**를
 *  `text`로 보낸다(조합 중의 키는 보내지 않는다). Enter · Backspace · 화살표 같은 특수 키만 `key`로 간다.
 * B(데스크톱 앱 · 앱 안 브라우저): 서버가 `app-view`로 뷰 id를 알려 오면 캔버스 대신 빈 자리를 두고, 그 자리를 앱에 알려
 *  WebContentsView를 위에 놓는다 — 사람이 뷰를 직접 누르고 친다(화면 전송 · 입력 전달 없음). 녹화 패널은 그대로다.
 *  ★뷰는 편집 화면보다 위에 그려진다 — 이 패널의 덮개(진행 · 고르기 목록 · 대화상자)가 보여야 할 때는 뷰를 숨긴다.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Phase, ServerMessage } from "@flowsmith/recorder/protocol";
import { IconArrowLeft } from "../icons.tsx";
import type { LiveTransport } from "./transport.ts";
import { desktop } from "./desktop.ts";

type SelectOpen = Extract<ServerMessage, { t: "select-open" }>;
type DialogOpen = Extract<ServerMessage, { t: "dialog" }>;

const BUTTON = ["left", "middle", "right"] as const;

/** human — 앞 단계 재생이 사람을 기다린다(로그인) · 이 동안은 재생 중이어도 페이지를 만질 수 있다 */
export function LiveView({ transport, phase, progress, onMeasure, human }: { transport: LiveTransport; phase: Phase; progress: string[]; onMeasure?: (size: { width: number; height: number }) => void; human?: { prompt: string } | null }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const keys = useRef<HTMLTextAreaElement>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const [scale, setScale] = useState(1);
  const [page, setPage] = useState({ url: "", title: "", canBack: false, depth: 0 });
  const [urlText, setUrlText] = useState("");
  const [select, setSelect] = useState<SelectOpen | null>(null);
  const [dialog, setDialog] = useState<DialogOpen | null>(null);
  const [promptText, setPromptText] = useState("");
  const composing = useRef(false);
  const lastMove = useRef(0);
  /** 앱 안 브라우저 뷰 — 있으면 캔버스 대신 이 자리에 앱이 뷰를 놓는다 */
  const [appView, setAppView] = useState<string | null>(null);

  // 서버 메시지
  useEffect(() => transport.onMessage((m) => {
    if (m.t === "viewport") setViewport({ width: m.width, height: m.height });
    if (m.t === "page") { setPage(m); setUrlText(m.url); }
    if (m.t === "select-open") setSelect(m);
    if (m.t === "dialog") { setDialog(m); setPromptText(m.defaultValue); }
    if (m.t === "app-view") setAppView(m.id);
  }), [transport]);

  // 화면 — 늦게 온 프레임이 먼저 온 프레임을 덮지 않게 순서를 센다
  useEffect(() => {
    let seq = 0, drawn = 0;
    return transport.onFrame(async (blob) => {
      const my = ++seq;
      const bmp = await createImageBitmap(blob);
      if (my < drawn) { bmp.close(); return; }
      drawn = my;
      const c = canvas.current;
      const ctx = c?.getContext("2d");
      if (c && ctx) ctx.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
    });
  }, [transport]);

  // 패널 크기 → 표시 배율 (+ 서버에 크기를 알린다)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let timer: number | undefined;
    const fit = () => {
      const r = el.getBoundingClientRect();
      setScale(Math.min(r.width / viewport.width, r.height / viewport.height, 1.5));
    };
    fit();
    // ★처음 잰 크기로 세션을 연다 — 대충 정한 크기로 열고 나중에 고치면, 준비된 뒤 페이지 배치가 다시 잡히는 틈에 클릭이 엇나갔다
    const first = el.getBoundingClientRect();
    let last = { width: Math.round(first.width), height: Math.round(first.height) };
    onMeasure?.(last);
    const ro = new ResizeObserver(() => {
      fit();
      const r = el.getBoundingClientRect();
      if (Math.abs(r.width - last.width) < 8 && Math.abs(r.height - last.height) < 8) return;   // 처음 관찰 · 자잘한 흔들림은 보내지 않는다
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const now = el.getBoundingClientRect();
        last = { width: Math.round(now.width), height: Math.round(now.height) };
        transport.send({ t: "resize", ...last });
      }, 400);
    });
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(timer); };
  }, [viewport.width, viewport.height, transport]);

  const pos = useCallback((e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: Math.round((e.clientX - r.left) / scale), y: Math.round((e.clientY - r.top) / scale) };
  }, [scale]);

  const ready = phase === "ready";

  // 앱 안 브라우저 — 자리를 앱에 알린다. 덮개가 떠야 할 때(준비 중 · 고르기 목록 · 대화상자)는 숨긴다.
  //  자리는 창 크기 · 스크롤 · 패널 움직임으로 바뀐다 — 잠깐마다 재서 바뀌었을 때만 보낸다
  const bridge = desktop();
  const showView = appView !== null && (ready || !!human) && !select && !dialog;
  useEffect(() => {
    if (!appView || !bridge) return;
    let last = "";
    let first = true;
    const tick = () => {
      const r = box.current?.getBoundingClientRect();
      const rect = showView && r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
      const key = JSON.stringify(rect);
      if (key === last) return;
      last = key;
      bridge.placeView(appView, rect);
      // 처음 놓인 뒤 페이지 크기를 다시 재게 한다(고르기 목록 자리 · 배율)
      if (rect && first) { first = false; window.setTimeout(() => transport.send({ t: "resize", width: Math.round(rect.width), height: Math.round(rect.height) }), 300); }
    };
    tick();
    const timer = window.setInterval(tick, 150);
    return () => { window.clearInterval(timer); bridge.placeView(appView, null); };
  }, [appView, bridge, showView, transport]);

  // 키보드 — textarea가 받는다
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || composing.current || e.key === "Process" || e.key === "Unidentified") return;
    const combo = e.ctrlKey || e.metaKey || e.altKey;
    if (e.key.length > 1 || combo) {
      e.preventDefault();
      transport.send({ t: "key", type: "down", key: e.key });
    }
  };
  const onKeyUp = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || composing.current) return;
    if (e.key.length > 1 || e.ctrlKey || e.metaKey || e.altKey) transport.send({ t: "key", type: "up", key: e.key });
  };
  const onInput = (e: FormEvent<HTMLTextAreaElement>) => {
    if (composing.current) return;
    const t = e.currentTarget.value;
    if (t) transport.send({ t: "text", text: t });
    e.currentTarget.value = "";
  };

  return (
    <div className="live">
      <div className="live-bar">
        <button className="icon-btn" title="뒤로" disabled={!ready || !page.canBack} onClick={() => transport.send({ t: "back" })}><IconArrowLeft /></button>
        <button className="icon-btn" title="새로고침" disabled={!ready} onClick={() => transport.send({ t: "reload" })}>⟳</button>
        <form className="grow" onSubmit={(e) => { e.preventDefault(); if (urlText.trim()) transport.send({ t: "nav", url: urlText.trim() }); }}>
          <input className="live-url mono" value={urlText} disabled={!ready} onChange={(e) => setUrlText(e.target.value)} aria-label="주소" />
        </form>
        {page.depth > 0 && (
          <button className="small" title="이 팝업 창을 닫고 연 창으로 돌아갑니다(녹화 중이면 «창 닫기»로 남습니다)" disabled={!ready} onClick={() => transport.send({ t: "close-window" })}>
            팝업 {page.depth > 1 ? `${page.depth}겹 ` : ""}· 창 닫기
          </button>
        )}
      </div>
      <div className="live-stage" ref={box}>
        {appView && !bridge && <div className="banner warn small" style={{ margin: 16 }}>앱 안 브라우저로 녹화합니다 — 데스크톱 앱 창에서 여세요(이 창에서는 보이지 않습니다)</div>}
        {!appView && <canvas
          ref={canvas}
          width={viewport.width}
          height={viewport.height}
          style={{ width: viewport.width * scale, height: viewport.height * scale }}
          tabIndex={-1}
          onMouseDown={(e) => {
            e.preventDefault();
            keys.current?.focus({ preventScroll: true });
            transport.send({ t: "mouse", type: "down", ...pos(e), button: BUTTON[e.button] ?? "left", clickCount: e.detail || 1 });
          }}
          onMouseUp={(e) => transport.send({ t: "mouse", type: "up", ...pos(e), button: BUTTON[e.button] ?? "left", clickCount: e.detail || 1 })}
          onMouseMove={(e) => {
            const now = performance.now();
            if (now - lastMove.current < 33) return;   // 초당 30번이면 충분하다
            lastMove.current = now;
            transport.send({ t: "mouse", type: "move", ...pos(e), button: "left", clickCount: 0 });
          }}
          onWheel={(e) => transport.send({ t: "wheel", ...pos(e), dx: e.deltaX, dy: e.deltaY })}
          onContextMenu={(e) => e.preventDefault()}
        />}
        <textarea
          ref={keys}
          className="live-keys"
          aria-label="라이브 페이지 키보드"
          autoCapitalize="off" autoComplete="off" spellCheck={false}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onInput={onInput}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={(e) => {
            composing.current = false;
            if (e.data) transport.send({ t: "text", text: e.data });
            e.currentTarget.value = "";
          }}
        />

        {select && (
          <div className="live-select" style={{ left: select.rect.x * scale, top: (select.rect.y + select.rect.height) * scale, minWidth: Math.max(160, select.rect.width * scale) }}>
            {select.options.map((o) => (
              <button key={o.value} className={o.selected ? "on" : ""} onClick={() => { transport.send({ t: "select-choose", token: select.token, value: o.value }); setSelect(null); }}>{o.label}</button>
            ))}
            <button className="cancel" onClick={() => { transport.send({ t: "select-choose", token: select.token, value: null }); setSelect(null); }}>닫기</button>
          </div>
        )}

        {dialog && (
          <div className="live-modal">
            <div className="card stack" style={{ padding: 16, width: 360 }}>
              <strong>페이지가 묻습니다</strong>
              <div>{dialog.message}</div>
              {dialog.kind === "prompt" && <input value={promptText} onChange={(e) => setPromptText(e.target.value)} />}
              <div className="banner warn small">실행할 때는 이 대화상자가 자동으로 «취소»됩니다 — 아직 녹화되지 않습니다</div>
              <div className="row"><span className="grow" />
                {dialog.kind !== "alert" && <button onClick={() => { transport.send({ t: "dialog", accept: false }); setDialog(null); }}>취소</button>}
                <button className="primary" onClick={() => { transport.send({ t: "dialog", accept: true, text: promptText }); setDialog(null); }}>확인</button>
              </div>
            </div>
          </div>
        )}

        {human && !appView && (
          <div className="live-human banner warn small" role="status">🙋 {human.prompt} — 이 화면에서 직접 하세요. 끝나면 재생이 이어 갑니다(넣은 것은 녹화하지 않습니다)</div>
        )}
        {!ready && !human && (
          <div className="live-modal">
            <div className="card stack" style={{ padding: 16, width: 420 }}>
              <div className="row"><span className="spinner dark" /><strong>{phase === "closed" ? "닫혔습니다" : phase === "replaying" ? "앞 단계를 재생하는 중" : "브라우저를 띄우는 중"}</strong></div>
              {progress.length > 0 && <pre className="json" style={{ maxHeight: 180 }}>{progress.slice(-8).join("\n")}</pre>}
            </div>
          </div>
        )}
      </div>
      {/* 제목 줄은 처음부터 자리를 잡는다 — 나중에 생기면 화면 칸이 줄어 페이지 크기가 다시 바뀐다 */}
      {/* 앱 안 브라우저 — 뷰가 패널을 덮으므로 사람 기다리기 안내는 여기에 · 키보드는 뷰가 바로 받는다 */}
      {<div className="live-foot small muted">
        {appView && human ? <span className="grow" role="status">🙋 {human.prompt} — 위 화면에서 직접 하세요. 끝나면 재생이 이어 갑니다(넣은 것은 녹화하지 않습니다)</span> : <span className="grow">{page.title || "\u00a0"}</span>}
        {!appView && <button className="small ghost" title="입력이 안 먹으면 눌러 키보드를 라이브 페이지로" onClick={() => keys.current?.focus()}>⌨ 키보드</button>}
      </div>}
    </div>
  );
}
