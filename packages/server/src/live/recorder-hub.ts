/**
 * **라이브 패널** — WebSocket `/api/live` 하나에 녹화 세션 하나 (PLAN §4.3 · §5).
 *
 *   화면 → 서버: JSON (open · mode · mouse · key · text · nav …)
 *   서버 → 화면: JSON (phase · recorded · page …) + 이진(JPEG 한 장 = screencast 프레임 하나)
 *
 * 녹화를 어디서(PLAN §28): 요청의 on — 없거나 「server」면 이 서버 · 「worker:<id>」면 그 PC의 워커 프로그램(WorkerHub.record).
 *  사람의 크롬에 붙는 플로우를 사내 서버에서 녹화하려면 그 크롬이 있는 PC여야 한다.
 *
 * ★★Origin을 본다. 인증이 없는 로컬 서버라, 사람이 연 **다른 웹사이트**가 ws://127.0.0.1에 붙으면
 *  저장된 시크릿으로 로그인한 화면을 볼 수 있다. 같은 출처에서 온 것만 받는다.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { chromium, type Browser } from "playwright";
import { DEFAULT_CDP_URL } from "@flowsmith/engine";
import { RecorderSession, type WalletSource } from "@flowsmith/recorder";
import type { SecretValue } from "@flowsmith/core";
import type { ClientMessage, OpenRequest, ServerMessage } from "@flowsmith/recorder/protocol";
import type { Secrets } from "../storage/secrets.ts";
import type { Store } from "../storage/store.ts";
import type { Recording, WorkerHub } from "../run/worker-hub.ts";
import { sameOrigin } from "../http/router.ts";
import { reject, type Upgrades } from "./upgrade.ts";

const IDLE_MS = 20 * 60_000;
/** 화면이 못 따라오면 프레임을 버린다 — 쌓이면 지연만 는다 */
const MAX_BUFFERED = 4 * 1024 * 1024;


export class LiveHub {
  readonly #wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  readonly #sessions = new Set<Recording>();
  #browser: Promise<Browser> | null = null;
  readonly #store: Store;
  readonly #secrets: Secrets;
  readonly #headless: boolean;
  readonly #cdpUrl: string;
  readonly #workers: WorkerHub | null;
  /** 지갑 브라우저 녹화 — 서버 안 워커가 창을 띄울 수 있을 때만(데스크톱 앱 · --headed) */
  readonly #walletSource: ((draft: OpenRequest["draft"], secrets: Record<string, SecretValue>, log: (t: string) => void) => Promise<WalletSource>) | null;

  constructor(store: Store, secrets: Secrets, opts: { headless?: boolean; cdpUrl?: string; workers?: WorkerHub; walletSource?: (draft: OpenRequest["draft"], secrets: Record<string, SecretValue>, log: (t: string) => void) => Promise<WalletSource> } = {}) {
    this.#workers = opts.workers ?? null;
    this.#walletSource = opts.walletSource ?? null;
    this.#store = store;
    this.#secrets = secrets;
    this.#headless = opts.headless ?? true;
    this.#cdpUrl = opts.cdpUrl ?? DEFAULT_CDP_URL;
  }

  #getBrowser(): Promise<Browser> {
    if (!this.#browser) {
      this.#browser = chromium.launch({ headless: this.#headless }).then((b) => {
        b.on("disconnected", () => { this.#browser = null; });
        return b;
      }, (e) => { this.#browser = null; throw e; });
    }
    return this.#browser;
  }

  /** allow — 들어와도 되나(로그인 · 역할). 녹화는 편집자 이상 */
  attach(upgrades: Upgrades, allow: (req: IncomingMessage) => boolean = () => true, canSee: (req: IncomingMessage, flowId: string) => boolean = () => true): void {
    upgrades.add(/^\/api\/live$/, (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!sameOrigin(req) || !allow(req)) { reject(socket, 403); return; }
      this.#wss.handleUpgrade(req, socket, head, (ws) => this.#serve(ws, (flowId) => canSee(req, flowId)));
    });
  }

  #serve(ws: WebSocket, canSee: (flowId: string) => boolean = () => true): void {
    let session: Recording | null = null;
    let opening = false;
    let idle: NodeJS.Timeout;
    // ★입력은 순서가 생명이다 — 누름 · 뗌 · 글자가 엇갈리면 엉뚱한 칸에 들어가고 클릭이 두 번 된다.
    //  메시지 처리기는 async라 그냥 두면 동시에 돈다. 줄을 세운다.
    let inputs: Promise<void> = Promise.resolve();
    const send = (m: ServerMessage) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
    const touch = () => { clearTimeout(idle); idle = setTimeout(() => { send({ t: "phase", phase: "closed", message: "오래 쓰지 않아 닫았습니다" }); ws.close(); }, IDLE_MS); };
    touch();

    ws.on("message", async (data, binary) => {
      touch();
      if (binary) return;
      let m: ClientMessage;
      try { m = JSON.parse(String(data)) as ClientMessage; } catch { return; }
      if (m.t === "open") {
        if (session || opening) return;
        // 팀 — 남의 팀 플로우는 녹화하지 못한다(시크릿이 풀린다)
        if (!canSee(m.flowId)) { send({ t: "notice", level: "error", text: "없는 워크플로우입니다" }); send({ t: "phase", phase: "closed", message: "열지 못했습니다" }); ws.close(); return; }
        opening = true;
        try {
          session = await this.#open(m, send, (jpeg) => { if (ws.readyState === ws.OPEN && ws.bufferedAmount < MAX_BUFFERED) ws.send(jpeg, { binary: true }); }, (s) => { session = s; });
          if (ws.readyState !== ws.OPEN) await this.#close(session);
        } catch (e) {
          send({ t: "notice", level: "error", text: `라이브 페이지를 열 수 없습니다 — ${(e as Error).message.split("\n")[0]}` });
          send({ t: "phase", phase: "closed", message: "열지 못했습니다" });
          ws.close();
        } finally {
          opening = false;
        }
        return;
      }
      inputs = inputs.then(() => session?.input(m)).catch(() => undefined);
    });
    ws.on("close", () => {
      clearTimeout(idle);
      if (session) void this.#close(session);
    });
  }

  /** created — 재생 전에 세션을 알린다(재생 중 사람 기다리기의 입력이 닿게 — RecorderSession.open) */
  async #open(req: OpenRequest, send: (m: ServerMessage) => void, frame: (b: Buffer) => void, created?: (s: Recording) => void): Promise<Recording> {
    this.#store.getFlow(req.flowId);   // 없는 플로우면 여기서 던진다
    // ★시크릿은 서버 저장소에서만 온다. 화면이 보낸 초안의 정의 중 값이 저장된 것만 풀린다
    const secrets = this.#secrets.unlockFor(req.flowId, Array.isArray(req.draft?.secrets) ? req.draft.secrets : []);
    // 팀 공용 변수 — 재생하는 표현식이 $vars로 읽는다(실행과 같게)
    if (req.draft) req = { ...req, draft: this.#secrets.withShared(req.flowId, req.draft).flow };
    // 그 PC의 워커에서 — 서버는 잇기만 한다
    if (typeof req.on === "string" && req.on.startsWith("worker:")) {
      if (!this.#workers) throw new Error("워커를 받지 않는 서버입니다");
      const r = this.#workers.record(req.on.slice(7), req, secrets, { send, frame });
      this.#sessions.add(r);
      return r;
    }
    // 사람의 크롬에 붙는 플로우면 녹화도 그 크롬에서 — 로그인 · 보안 프로그램을 사람이 지나 둔 탭이다(B2)
    // 지갑 브라우저면 MetaMask를 실은 크롬 — 창이 보이는 서버만(아니면 그 PC의 워커에서 녹화)
    const browser = req.draft?.settings?.browser;
    if (browser === "wallet" && !this.#walletSource) throw new Error("이 서버는 지갑 브라우저(MetaMask)를 열 수 없습니다 — «녹화 시작»에서 화면이 있는 PC의 워커를 고르세요");
    const src = browser === "attach" ? { cdpUrl: this.#cdpUrl }
      : browser === "wallet" ? await this.#walletSource!(req.draft, secrets, (text) => send({ t: "progress", text }))
      : await this.#getBrowser();
    const s = await RecorderSession.open(src, req, secrets, { send, frame }, created);
    this.#sessions.add(s);
    return s;
  }

  async #close(s: Recording): Promise<void> {
    this.#sessions.delete(s);
    await s.close();
  }

  async close(): Promise<void> {
    for (const ws of this.#wss.clients) ws.terminate();
    await Promise.all([...this.#sessions].map((s) => s.close()));
    this.#sessions.clear();
    const b = this.#browser;
    this.#browser = null;
    if (b) await (await b).close().catch(() => undefined);
  }
}
