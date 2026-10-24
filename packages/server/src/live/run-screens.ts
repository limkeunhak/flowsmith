/**
 * **실행 화면 보기** — 돌고 있는 실행의 실제 브라우저 화면을 보기만 한다.
 *
 *   WebSocket /api/runs/:runId/screen   서버 → 화면: JPEG 프레임(바이너리) · { t: "page" | "viewport" | "wait" | "end" }
 *
 * ★보는 사람이 있을 때만 보낸다 — 실행은 «지금 페이지»를 알려 주기만 하고(가볍다),
 *  첫 사람이 붙으면 그 페이지에 CDP 화면 전송을 걸고, 마지막 사람이 떠나면 끈다. 여럿이 보면 하나를 나눠 본다.
 * ★보기만 — 화면에서 오는 입력은 받지 않는다(실행과 엉킨다). 캡처는 남기지 않는다.
 *  **사람 기다리기**(로그인 · 인증) 동안에만 입력을 받는다 — 실행이 멈춰 사람을 기다리는 때라 엉키지 않는다.
 *  누를 수 있는 사람은 그 실행을 볼 수 있는 실행자 이상(canControl). 입력은 기록하지 않는다(비밀번호가 지나간다).
 * ★페이지가 바뀌면(다음 노드 · 팝업) 따라간다.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Page } from "playwright";
import { startScreencast, type Screencast } from "@flowsmith/engine";
import type { ScreenControl, ScreenMeta, ScreenSink } from "@flowsmith/worker";
import { WebSocketServer, type WebSocket } from "ws";
import { reject, type Upgrades } from "./upgrade.ts";
import { sameOrigin } from "../http/router.ts";

/** 화면이 못 따라오면 프레임을 버린다 */
const MAX_BUFFERED = 2 * 1024 * 1024;
/** 끝난 실행의 «마지막 화면»을 잠깐 붙잡아 둔다 — 끝나는 순간 붙은 사람도 끝을 안다 */
const KEEP_ENDED_MS = 30_000;
/** 입력 하나가 이보다 오래 걸리면 기다리지 않고 다음으로 — 페이지가 바쁠 때 뒤의 입력이 줄줄이 막히지 않게 */
const INPUT_TIMEOUT_MS = 3_000;
/** 줄이 이만큼 밀려 있으면 마우스 이동은 버린다(누르기 · 떼기 · 키는 버리지 않는다) */
const MAX_QUEUED_MOVES = 2;
/** FLOWSMITH_DEBUG_SCREEN=1 — 받은 입력의 종류 · 자리 · 걸린 시간을 서버 콘솔에. ★친 글자는 남기지 않는다(길이만) */
const DEBUG = process.env["FLOWSMITH_DEBUG_SCREEN"] === "1";

type Msg =
  | { t: "page"; url: string; title: string }
  | { t: "viewport"; width: number; height: number }
  | { t: "wait"; message: string }
  | { t: "end"; status: string; message: string }
  /** 사람 기다리기 — prompt가 null이면 끝(다시 보기만). control: 이 사람이 누를 수 있나 */
  | { t: "human"; prompt: string | null; deadline: string | null; control: boolean };

/** 화면에서 오는 입력 — 사람 기다리기 동안만(녹화기의 ClientMessage 중 손에 해당하는 것) */
type Input =
  | { t: "mouse"; type: "move" | "down" | "up"; x: number; y: number; button: "left" | "right" | "middle"; clickCount: number }
  | { t: "wheel"; x: number; y: number; dx: number; dy: number }
  | { t: "key"; type: "down" | "up"; key: string }
  | { t: "text"; text: string };

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** 디버그 한 줄 — ★친 글자는 길이만, 보통 키는 «•» */
const describeInput = (m: Input): string =>
  m.t === "mouse" ? `mouse ${m.type} ${Math.round(m.x)},${Math.round(m.y)}` : m.t === "wheel" ? `wheel ${Math.round(m.x)},${Math.round(m.y)} dy=${Math.round(m.dy)}`
    : m.t === "key" ? `key ${m.type} ${m.key.length > 1 ? m.key : "•"}` : `text (${m.text.length}자)`;

function inputOf(raw: unknown): Input | null {
  let m: Record<string, unknown>;
  try { m = JSON.parse(String(raw)) as Record<string, unknown>; } catch { return null; }
  if (m === null || typeof m !== "object") return null;
  if (m["t"] === "mouse" && ["move", "down", "up"].includes(String(m["type"])) && num(m["x"]) && num(m["y"])) {
    const button = (["left", "right", "middle"].includes(String(m["button"])) ? m["button"] : "left") as "left" | "right" | "middle";
    const clicks = num(m["clickCount"]) ? Math.min(3, Math.max(0, m["clickCount"])) : 1;
    return { t: "mouse", type: m["type"] as "move" | "down" | "up", x: m["x"], y: m["y"], button, clickCount: clicks };
  }
  if (m["t"] === "wheel" && num(m["x"]) && num(m["y"]) && num(m["dx"]) && num(m["dy"])) return { t: "wheel", x: m["x"], y: m["y"], dx: m["dx"], dy: m["dy"] };
  if (m["t"] === "key" && (m["type"] === "down" || m["type"] === "up") && typeof m["key"] === "string" && m["key"].length <= 32) return { t: "key", type: m["type"], key: m["key"] };
  if (m["t"] === "text" && typeof m["text"] === "string" && m["text"].length <= 1000) return { t: "text", text: m["text"] };
  return null;
}

interface Screen {
  page: Page | null;
  viewers: Set<WebSocket>;
  /** 지금 걸린 화면 전송 */
  cast: Screencast | null;
  /** 지금 화면 전송이 걸린 페이지 */
  casting: Page | null;
  ended: Msg | null;
  lastSize: string;
  /** 화면이 없는 까닭 — 옛 워커(중계를 모름)에서 돈다 */
  note?: string;
  /** 워커에서 돈다 — 화면은 그 PC가 보내 준다(보는 사람이 있을 때만 켠다 · 사람의 손도 그리로) */
  remote?: { worker: string; ctl: ScreenControl };
  /** 사람 기다리기 중이면 — 이때만 입력을 받는다 */
  human: { prompt: string; deadline: string | null } | null;
  /** 누를 수 있는 사람(연결마다) */
  control: WeakSet<WebSocket>;
  /** 입력은 차례대로 — 마우스 down/up이 뒤바뀌지 않게 */
  inputs: Promise<void>;
  /** 아직 처리하지 않은 입력 수 · 그중 마우스 이동 수 */
  queued: number;
  queuedMoves: number;
  /**
   * 지금 화면의 크기 · 주소 · 마지막 화면 — **나중에 붙은 사람**에게 바로 준다.
   * ★화면 전송은 그림이 바뀔 때만 오고 크기도 바뀔 때만 알린다 — 이미 보내는 중에 붙으면 아무것도 못 받았다(2026-10-17,
   *  크기를 모르면 화면은 1280×800으로 짐작해 720 높이의 페이지에서 누른 자리가 아래로 밀렸다)
   */
  viewport: { width: number; height: number } | null;
  pageInfo: { url: string; title: string } | null;
  lastFrame: Buffer | null;
}

const PATH_RE = /^\/api\/runs\/([^/]+)\/screen$/;

export class RunScreens {
  readonly #wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  readonly #runs = new Map<string, Screen>();
  /** 이동 알림을 이미 단 페이지 */
  readonly #watched = new WeakSet<Page>();

  /** 실행이 시작될 때 — 엔진의 onPage로 넘길 함수를 돌려준다 */
  track(runId: string): (page: Page) => void {
    this.#runs.set(runId, { page: null, viewers: new Set(), cast: null, casting: null, ended: null, lastSize: "", human: null, control: new WeakSet(), inputs: Promise.resolve(), queued: 0, queuedMoves: 0, viewport: null, pageInfo: null, lastFrame: null });
    return (page) => {
      const s = this.#runs.get(runId);
      if (!s || s.ended) return;
      s.page = page;
      if (s.viewers.size > 0) void this.#cast(s);
    };
  }

  /**
   * 실행이 워커로 갔고 그 워커가 화면을 보내 준다(PLAN §44 · 4단계) — 보는 사람이 있으면 켠다.
   * ☆서버에서 도는 실행보다 한 단계 더 건너간다 — 조금 늦다
   */
  remote(runId: string, worker: string, ctl: ScreenControl): void {
    const s = this.#runs.get(runId);
    if (!s || s.ended) return;
    s.remote = { worker, ctl };
    delete s.note;
    if (s.viewers.size > 0) {
      ctl.watch(true);
      for (const ws of s.viewers) this.#send(ws, { t: "wait", message: `워커 «${worker}»의 화면을 받는 중…` });
    }
  }

  /** 워커에서 온 화면 · 크기 · 주소가 여기로(WorkerHub) */
  sink(runId: string): ScreenSink {
    return {
      frame: (jpeg) => {
        const s = this.#runs.get(runId);
        if (!s || s.ended || !s.remote) return;
        s.lastFrame = jpeg;
        for (const ws of s.viewers) if (ws.readyState === ws.OPEN && ws.bufferedAmount < MAX_BUFFERED) ws.send(jpeg, { binary: true });
      },
      meta: (m: ScreenMeta) => {
        const s = this.#runs.get(runId);
        if (!s || s.ended || !s.remote) return;
        if (m.t === "viewport") s.viewport = { width: m.width, height: m.height };
        else s.pageInfo = { url: m.url, title: m.title };
        this.#broadcast(s, m);
      },
    };
  }

  /** 실행이 워커(사람 PC)로 갔다 — 화면은 그 PC에 있다(중계를 모르는 옛 워커). 보는 사람에게 그렇게 알린다 */
  elsewhere(runId: string, worker: string): void {
    const s = this.#runs.get(runId);
    if (!s) return;
    s.note = `이 실행은 워커 «${worker}»에서 돕니다 — 화면 보기는 서버에서 도는 실행만 됩니다`;
    for (const ws of s.viewers) this.#send(ws, { t: "wait", message: s.note });
  }

  /** 사람 기다리기가 시작됐다 · 끝났다(null) — 보는 사람마다 «누를 수 있나»를 알린다 */
  human(runId: string, w: { prompt: string; deadline: string | null } | null): void {
    const s = this.#runs.get(runId);
    if (!s || s.ended) return;
    s.human = w;
    for (const ws of s.viewers) this.#send(ws, this.#humanMsg(s, ws));
  }

  #humanMsg(s: Screen, ws: WebSocket): Msg {
    return { t: "human", prompt: s.human?.prompt ?? null, deadline: s.human?.deadline ?? null, control: s.human !== null && s.control.has(ws) };
  }

  /** 시험용 — 사람 기다리기 중인가 */
  waiting(runId: string): boolean { return this.#runs.get(runId)?.human != null; }

  /** 실행이 끝났다 */
  end(runId: string, status: string, message: string): void {
    const s = this.#runs.get(runId);
    if (!s) return;
    s.ended = { t: "end", status, message };
    for (const ws of s.viewers) { this.#send(ws, s.ended); ws.close(); }
    void this.#stop(s);
    setTimeout(() => this.#runs.delete(runId), KEEP_ENDED_MS).unref();
  }

  /**
   * allow — 들어와도 되나(로그인). 실행 화면은 보는 사람 이상.
   * canControl — 사람 기다리기 동안 눌러도 되나(실행자 이상 · 그 실행을 볼 수 있는 사람)
   */
  attach(upgrades: Upgrades, allow: (req: IncomingMessage) => boolean = () => true, canSee: (req: IncomingMessage, runId: string) => boolean = () => true,
    canControl: (req: IncomingMessage) => boolean = () => true): void {
    upgrades.add(PATH_RE, (req: IncomingMessage, socket: Duplex, head: Buffer, m) => {
      const runId = decodeURIComponent(m[1]!);
      if (!sameOrigin(req) || !allow(req) || !canSee(req, runId)) { reject(socket, 403); return; }
      const control = canControl(req);
      this.#wss.handleUpgrade(req, socket, head, (ws) => this.#serve(runId, ws, control));
    });
  }

  #serve(runId: string, ws: WebSocket, control = false): void {
    const s = this.#runs.get(runId);
    if (!s) {
      this.#send(ws, { t: "end", status: "unknown", message: "돌고 있는 실행이 아닙니다 — 이미 끝났거나 다른 서버에서 돕니다" });
      ws.close();
      return;
    }
    if (s.ended) { this.#send(ws, s.ended); ws.close(); return; }
    s.viewers.add(ws);
    if (control) s.control.add(ws);
    // 보기만 — 사람 기다리기 동안 · 누를 수 있는 사람의 입력만 페이지로 보낸다(그 밖에는 버린다)
    ws.on("message", (raw) => {
      // 워커에서 도는 실행 — 손은 그 PC로(거르는 것은 같다: 사람 기다리기 동안 · 누를 수 있는 사람)
      if (s.remote) {
        if (!s.human || !s.control.has(ws)) return;
        const m = inputOf(raw);
        if (m) s.remote.ctl.input(m);
        return;
      }
      if (!s.human || !s.control.has(ws) || !s.page || s.page.isClosed()) return;
      const m = inputOf(raw);
      if (!m) return;
      const move = m.t === "mouse" && m.type === "move";
      if (move && s.queuedMoves >= MAX_QUEUED_MOVES) return;
      const page = s.page;
      s.queued++;
      if (move) s.queuedMoves++;
      s.inputs = s.inputs.then(async () => {
        const t0 = Date.now();
        let ok = true;
        // ★한 입력이 오래 걸려도 뒤가 막히지 않게 — 그 입력은 뒤에서 마저 돈다
        await Promise.race([this.#apply(page, m), new Promise<void>((r) => setTimeout(() => { ok = false; r(); }, INPUT_TIMEOUT_MS))]).catch(() => { ok = false; });
        if (DEBUG) console.log(`[screen ${runId.slice(0, 8)}] ${describeInput(m)} · ${Date.now() - t0}ms${ok ? "" : " · 늦음/실패"} · 줄 ${s.queued - 1}`);
      }).finally(() => { s.queued--; if (move) s.queuedMoves--; });
    });
    if (s.human) this.#send(ws, this.#humanMsg(s, ws));
    ws.on("close", () => {
      s.viewers.delete(ws);
      if (s.viewers.size === 0) { s.remote?.ctl.watch(false); void this.#stop(s); }
    });
    if (s.remote) {
      // 워커에서 — 처음 보는 사람이면 그 PC에 켜라고 · 이미 받는 중이면 지금 것을 바로
      if (s.viewers.size === 1) s.remote.ctl.watch(true);
      if (s.viewport) this.#send(ws, { t: "viewport", ...s.viewport });
      if (s.pageInfo) this.#send(ws, { t: "page", ...s.pageInfo });
      if (s.lastFrame && ws.readyState === ws.OPEN) ws.send(s.lastFrame, { binary: true });
      else this.#send(ws, { t: "wait", message: `워커 «${s.remote.worker}»의 화면을 받는 중…` });
    } else if (s.page && s.casting === s.page) {
      // 이미 보내는 중 — 지금 크기 · 주소 · 마지막 화면을 바로 준다(그림이 바뀔 때까지 기다리지 않게)
      if (s.viewport) this.#send(ws, { t: "viewport", ...s.viewport });
      if (s.pageInfo) this.#send(ws, { t: "page", ...s.pageInfo });
      if (s.lastFrame && ws.readyState === ws.OPEN) ws.send(s.lastFrame, { binary: true });
    } else if (s.page) void this.#cast(s);
    else this.#send(ws, { t: "wait", message: s.note ?? "아직 브라우저를 쓰는 노드가 아닙니다 — 웹페이지 노드가 시작되면 보입니다" });
  }

  /**
   * 지금 페이지에 화면 전송을 건다(이미 걸려 있으면 그대로).
   * ★바쁜 PC에서 보는 사람이 20초 동안 아무것도 못 받은 일이 있다(전체 시험 — 받은 것 없음 · 화면 0장) — 그래서
   *   주소는 걸기 전에 먼저 알리고 · 걸기가 실패하거나 10초 넘게 안 되면 다시(세 번까지) · 걸었는데 첫 화면이 1.5초 안에 안 오면
   *   (가만히 있는 페이지는 화면을 안 보내기도 한다) 한 장 찍어 보낸다
   */
  async #cast(s: Screen, attempt = 0): Promise<void> {
    const page = s.page;
    if (!page || s.casting === page || s.ended) return;
    await this.#stop(s);
    if (page.isClosed()) return;
    s.casting = page;
    // 주소는 바로 · 제목은 읽히면 덧붙여 — 제목 읽기는 바쁜 PC에서 다음 이동과 엇갈려 실패할 수 있다
    const announce = (url: string) => {
      s.pageInfo = { url, title: s.pageInfo?.url === url ? s.pageInfo.title : "" };
      this.#broadcast(s, { t: "page", ...s.pageInfo });
      void page.title().then((title) => {
        if (s.casting !== page || page.url() !== url || title === s.pageInfo?.title) return;
        s.pageInfo = { url, title };
        this.#broadcast(s, { t: "page", ...s.pageInfo });
      }, () => undefined);
    };
    announce(page.url());
    if (!this.#watched.has(page)) {
      this.#watched.add(page);
      page.on("framenavigated", (fr) => { if (s.casting === page && fr === page.mainFrame()) announce(fr.url()); });
    }
    let frames = 0;
    const show = (jpeg: Buffer) => {
      s.lastFrame = jpeg;
      for (const ws of s.viewers) if (ws.readyState === ws.OPEN && ws.bufferedAmount < MAX_BUFFERED) ws.send(jpeg, { binary: true });
    };
    const started = startScreencast(page, (jpeg, device) => {
      if (s.casting !== page || s.ended) return;   // 다른 페이지로 옮겼다 — 늦은 화면은 버린다
      frames++;
      const size = `${device.width}x${device.height}`;
      if (size !== s.lastSize) {
        s.lastSize = size;
        s.viewport = { width: Math.round(device.width), height: Math.round(device.height) };
        this.#broadcast(s, { t: "viewport", ...s.viewport });
      }
      show(jpeg);
    }, { quality: 60, maxWidth: 1600, maxHeight: 1200 });
    let timer: NodeJS.Timeout | undefined;
    try {
      const cast = await Promise.race([started, new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error("화면 전송을 걸지 못했습니다(시간 넘김)")), 10_000); })]);
      clearTimeout(timer);
      if (s.casting !== page || s.viewers.size === 0 || s.ended) { await cast.stop(); return; }
      s.cast = cast;
      setTimeout(() => {
        if (frames > 0 || s.casting !== page || s.ended || s.viewers.size === 0 || page.isClosed()) return;
        void page.screenshot({ type: "jpeg", quality: 60, timeout: 5000 }).then((jpeg) => {
          if (frames > 0 || s.casting !== page || s.ended) return;
          if (!s.viewport) {
            const v = page.viewportSize();
            if (v) { s.viewport = { width: v.width, height: v.height }; this.#broadcast(s, { t: "viewport", ...s.viewport }); }
          }
          show(jpeg);
        }, () => undefined);
      }, 1500).unref();
    } catch {
      clearTimeout(timer);
      void started.then((c) => c.stop(), () => undefined);   // 늦게라도 걸렸으면 거둔다
      if (s.casting === page) s.casting = null;
      if (attempt < 3 && !page.isClosed() && !s.ended && s.viewers.size > 0) {
        setTimeout(() => { if (s.page === page && s.casting === null && !s.ended && s.viewers.size > 0) void this.#cast(s, attempt + 1); }, 700 * (attempt + 1)).unref();
      }
    }
  }

  /** 사람의 손을 페이지로 — ★무엇을 쳤는지는 남기지 않는다(비밀번호) */
  async #apply(page: Page, m: Input): Promise<void> {
    switch (m.t) {
      case "mouse":
        await page.mouse.move(m.x, m.y);
        if (m.type === "down") await page.mouse.down({ button: m.button, clickCount: m.clickCount });
        if (m.type === "up") await page.mouse.up({ button: m.button, clickCount: m.clickCount });
        break;
      case "wheel": await page.mouse.move(m.x, m.y); await page.mouse.wheel(m.dx, m.dy); break;
      case "key":
        if (m.type === "down") await page.keyboard.down(m.key).catch(() => undefined);
        else await page.keyboard.up(m.key).catch(() => undefined);
        break;
      case "text": await page.keyboard.insertText(m.text); break;
    }
  }

  async #stop(s: Screen): Promise<void> {
    const cast = s.cast;
    s.cast = null;
    s.casting = null;
    s.lastSize = "";
    s.viewport = null;
    s.pageInfo = null;
    s.lastFrame = null;
    await cast?.stop();
  }

  #broadcast(s: Screen, m: Msg): void {
    for (const ws of s.viewers) this.#send(ws, m);
  }

  #send(ws: WebSocket, m: Msg): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  }

  async close(): Promise<void> {
    for (const s of this.#runs.values()) { for (const ws of s.viewers) ws.terminate(); await this.#stop(s); }
    this.#runs.clear();
  }

  /** 시험용 — 이 실행을 보는 사람 수 · 화면 전송이 걸려 있나 */
  stats(runId: string): { viewers: number; casting: boolean } | null {
    const s = this.#runs.get(runId);
    return s ? { viewers: s.viewers.size, casting: s.cast !== null } : null;
  }
}
