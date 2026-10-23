/**
 * 라이브 패널의 **연결** — 표시 방식을 갈아 끼우는 자리 (PLAN §4.3, 결정 1).
 *
 *   A(지금): WebSocket + 서버 Chromium screencast. 화면은 JPEG을 그리고, 입력은 좌표 · 글자로 보낸다
 *   B(나중): Electron WebContentsView. 화면은 앱이 직접 그리고 입력 메시지는 필요 없다.
 *            녹화 메시지(recorded · select-open · dialog …)는 그대로 — 같은 RecorderSession이 CDP로 붙는다
 *
 * 녹화 패널(Recorder)은 이 인터페이스만 안다.
 */
import type { ClientMessage, OpenRequest, ServerMessage } from "@flowsmith/recorder/protocol";

export interface LiveTransport {
  open(req: OpenRequest): void;
  send(m: ClientMessage): void;
  onMessage(fn: (m: ServerMessage) => void): () => void;
  /** 화면 한 장 — B에서는 오지 않는다 */
  onFrame(fn: (jpeg: Blob) => void): () => void;
  onClose(fn: (reason: string) => void): () => void;
  close(): void;
}

export class WsTransport implements LiveTransport {
  readonly #ws: WebSocket;
  readonly #pending: string[] = [];
  readonly #msg = new Set<(m: ServerMessage) => void>();
  readonly #frame = new Set<(b: Blob) => void>();
  readonly #close = new Set<(r: string) => void>();

  constructor(url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`) {
    this.#ws = new WebSocket(url);
    this.#ws.binaryType = "blob";
    this.#ws.onopen = () => { for (const p of this.#pending.splice(0)) this.#ws.send(p); };
    this.#ws.onmessage = (e) => {
      if (e.data instanceof Blob) { for (const f of this.#frame) f(e.data); return; }
      const m = JSON.parse(String(e.data)) as ServerMessage;
      for (const f of this.#msg) f(m);
    };
    this.#ws.onclose = (e) => { for (const f of this.#close) f(e.reason || "연결이 끊겼습니다"); };
  }

  #raw(s: string): void {
    if (this.#ws.readyState === WebSocket.OPEN) this.#ws.send(s);
    else if (this.#ws.readyState === WebSocket.CONNECTING) this.#pending.push(s);
  }

  open(req: OpenRequest): void { this.#raw(JSON.stringify(req)); }
  send(m: ClientMessage): void { this.#raw(JSON.stringify(m)); }
  onMessage(fn: (m: ServerMessage) => void) { this.#msg.add(fn); return () => this.#msg.delete(fn); }
  onFrame(fn: (b: Blob) => void) { this.#frame.add(fn); return () => this.#frame.delete(fn); }
  onClose(fn: (r: string) => void) { this.#close.add(fn); return () => this.#close.delete(fn); }
  close(): void { this.#ws.close(); }
}
