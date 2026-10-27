/**
 * **워커 프로그램의 속** — 사람 PC에서 서버에 붙어 일을 받아 돌린다.
 *
 * - 연결은 이쪽에서 건다 · 끊기면 다시 건다(1초 → 최대 30초). 토큰이 거절되면(지워짐 · 바뀜) 멈춘다.
 * - 일은 안의 InProcessWorker가 돈다. 다른 플로우 실행 · 파일 · 승인은 서버에 묻는다(ask) — **파일은 늘 서버에 남는다**.
 * - 서버와 끊기면 돌던 일을 멈춘다 — 서버는 그 실행을 이미 «연결이 끊김»으로 적었다.
 * - **확장 플러그인**(PLAN §41): 서버가 켜 둔 목록을 알리면 이 PC에 받아 두고(해시 확인) 싣는다 — PC마다 손으로 깔지 않는다.
 * - **녹화**(PLAN §28): 서버가 rec-open을 보내면 이 PC에서 녹화 세션을 연다 — attach 플로우면 이 PC의 크롬(사람이 로그인해 둔 탭).
 *   사람은 자기 크롬 창에서 직접 해도 되고 Studio의 화면에서 해도 된다. 녹화는 실행 자리를 쓰지 않는다.
 * - **실행 화면 중계**(PLAN §44 · 4단계): 서버에서 누가 «실제 화면 보기»를 열면 이 PC에서 도는 실행의 화면을 보낸다(screen-relay.ts) ·
 *   그래서 이 PC의 실행도 사람 기다리기를 할 수 있다(사람의 손은 서버를 거쳐 온다).
 */
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { chromium, type Browser } from "playwright";
import type { SecretValue } from "@flowsmith/core";
import { DEFAULT_CDP_URL, type ApprovalAnswer, type CallFlowRequest, type CallFlowResult, type FileOps } from "@flowsmith/engine";
import { RecorderSession } from "@flowsmith/recorder";
import type { ClientMessage, OpenRequest, ServerMessage } from "@flowsmith/recorder/protocol";
import type { RunJob } from "./job.ts";
import type { InProcessWorker } from "./local.ts";
import { PluginCache, type PluginRef } from "./plugin-cache.ts";
import { CLOSE, CONNECT_PATH, packFrame, PROTOCOL, runFrameId, type ApprovalRequest, type FileFn, type FromWorker, type ToWorker, type WorkerPolicy } from "./protocol.ts";
import { ScreenRelay } from "./screen-relay.ts";

/** 화면이 못 따라오면 프레임을 버린다 — 쌓이면 지연만 는다 */
const MAX_BUFFERED = 4 * 1024 * 1024;

interface Rec {
  session: RecorderSession | null;
  /** 열리기 전에 닫으라고 왔으면 */
  closed: boolean;
  /** ★입력은 순서대로 — 누름 · 뗌 · 글자가 엇갈리면 엉뚱한 칸에 들어간다 */
  inputs: Promise<void>;
}

export type AgentState = "connecting" | "online" | "offline" | "denied" | "closed";

export interface AgentOptions {
  /** 서버 주소 — https://studio.사내:4400 */
  server: string;
  token: string;
  worker: InProcessWorker;
  /** 끊기면 다시 붙나(기본 예) */
  reconnect?: boolean;
  /** 서버가 정책을 알려 주면 — main.ts가 엔진에 건다(시험은 건드리지 않는다) */
  onPolicy?: (p: WorkerPolicy) => void;
  log?: (text: string) => void;
  /** 서버가 나눠 준 플러그인을 받아 두는 곳(기본 ~/.flowsmith/worker-plugins) */
  pluginsDir?: string;
}

/** 묶음 하나를 받는 데 기다리는 시간 */
const PLUGIN_FETCH_MS = 120_000;

export class WorkerAgent {
  readonly #o: AgentOptions;
  #ws: WebSocket | null = null;
  #state: AgentState = "connecting";
  #closed = false;
  #backoff = 1000;
  #seq = 0;
  readonly #asks = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
  readonly #running = new Map<string, AbortController>();
  /** 돌고 있는 실행의 화면 중계 */
  readonly #screens = new Map<string, ScreenRelay>();
  readonly #recs = new Map<string, Rec>();
  #recBrowser: Promise<Browser> | null = null;
  #online: { resolve: () => void; reject: (e: Error) => void } | null = null;
  readonly #plugins: PluginCache;
  /** 달라고 한 묶음 — id@버전 → 받을 곳 */
  readonly #fetches = new Map<string, { ok: (b: Buffer) => void; fail: (e: Error) => void }>();
  name: string | null = null;
  /** 서버가 알려 준 이 워커의 id(welcome) — 데스크톱 앱이 편집 화면에 «내 PC»로 알린다 */
  id: string | null = null;

  constructor(o: AgentOptions) {
    this.#o = o;
    this.#plugins = new PluginCache(o.pluginsDir ?? process.env["FLOWSMITH_WORKER_PLUGINS_DIR"] ?? join(homedir(), ".flowsmith", "worker-plugins"), o.worker.extensions);
  }

  get state(): AgentState { return this.#state; }
  get running(): string[] { return [...this.#running.keys()]; }
  /** 지금 열린 녹화 수 */
  get recordings(): number { return this.#recs.size; }

  /** 붙는다 — 처음 받아들여질 때까지 기다린다(거절되면 실패) */
  start(): Promise<void> {
    return new Promise<void>((resolve, reject) => { this.#online = { resolve, reject }; this.#connect(); });
  }

  #log(text: string): void { (this.#o.log ?? console.log)(text); }

  #connect(): void {
    if (this.#closed) return;
    this.#state = "connecting";
    const url = new URL(CONNECT_PATH, this.#o.server.replace(/^http/, "ws"));
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${this.#o.token}` } });
    this.#ws = ws;
    ws.on("open", () => this.#send({ t: "hello", protocol: PROTOCOL, host: hostname(), version: process.version, extensions: this.#o.worker.extensions.list().map((e) => e.id), plugins: true, capabilities: this.#o.worker.capabilities }));
    ws.on("message", (d) => {
      let m: ToWorker;
      try { m = JSON.parse(String(d)) as ToWorker; } catch { return; }
      this.#handle(m);
    });
    ws.on("unexpected-response", (_req, res) => {
      const why = res.statusCode === 401 ? "토큰이 맞지 않습니다 — 관리자에게 새 토큰을 받으세요" : `서버가 받지 않았습니다(${res.statusCode})`;
      this.#deny(why);
    });
    ws.on("error", (e) => { if (this.#state === "connecting") this.#log(`서버에 붙지 못했습니다 — ${e.message}`); });
    ws.on("close", (code, reason) => {
      if (this.#ws !== ws) return;
      this.#ws = null;
      this.#dropAll("서버와 연결이 끊겼습니다");
      if (code === CLOSE.revoked || code === CLOSE.protocol) { this.#deny(String(reason) || "서버가 이 워커를 받지 않습니다"); return; }
      if (code === CLOSE.replaced) this.#log("같은 워커가 다른 곳에서 붙었습니다 — 이쪽은 끊깁니다");
      if (this.#state === "denied" || this.#closed) return;
      this.#state = "offline";
      if (this.#o.reconnect === false || code === CLOSE.replaced) return;
      const wait = this.#backoff;
      this.#backoff = Math.min(30_000, this.#backoff * 2);
      setTimeout(() => this.#connect(), wait).unref();
    });
  }

  #deny(why: string): void {
    if (this.#state === "denied") return;
    this.#state = "denied";
    this.#log(why);
    this.#online?.reject(new Error(why));
    this.#online = null;
    this.#ws?.close();
  }

  #send(m: FromWorker): void {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(m));
  }

  #handle(m: ToWorker): void {
    switch (m.t) {
      case "welcome":
        this.#state = "online";
        this.#backoff = 1000;
        this.name = m.worker.name;
        this.id = m.worker.id;
        this.#o.onPolicy?.(m.policy);
        this.#log(`서버에 붙었습니다 — 이 PC는 «${m.worker.name}»`);
        this.#online?.resolve();
        this.#online = null;
        return;
      case "job": void this.#run(m.job); return;
      case "cancel": this.#running.get(m.runId)?.abort(); return;
      case "rec-open": void this.#recOpen(m.sid, m.req, m.secrets); return;
      case "rec-input": {
        const r = this.#recs.get(m.sid);
        if (r) r.inputs = r.inputs.then(() => r.session?.input(m.m as ClientMessage)).catch(() => undefined);
        return;
      }
      case "rec-close": void this.#recClose(m.sid); return;
      case "screen": this.#screens.get(m.runId)?.watch(m.on); return;
      case "screen-input": this.#screens.get(m.runId)?.input(m.m); return;
      case "plugins": void this.#syncPlugins(m.list); return;
      case "plugin-data": {
        const key = `${m.id}@${m.version}`;
        const f = this.#fetches.get(key);
        if (!f) return;
        this.#fetches.delete(key);
        if (m.ok) f.ok(Buffer.from(m.data, "base64")); else f.fail(new Error(m.error));
        return;
      }
      case "reply": {
        const a = this.#asks.get(m.id);
        if (!a) return;
        this.#asks.delete(m.id);
        if (m.ok) a.ok(m.value); else a.fail(new Error(m.error));
        return;
      }
    }
  }

  /** 서버가 알린 플러그인대로 — 받고 · 싣고 · 다 되면 알린다(그때까지 서버는 이 워커로 그 확장의 일을 보내지 않는다) */
  async #syncPlugins(list: PluginRef[]): Promise<void> {
    const r = await this.#plugins.sync(list, (id, version) => this.#fetchPlugin(id, version), (t) => this.#log(t));
    this.#send({ t: "extensions", extensions: r.extensions, plugins: r.plugins, errors: r.errors });
    if (Object.keys(r.plugins).length) this.#log(`플러그인: ${Object.entries(r.plugins).map(([id, v]) => `${id} ${v}`).join(", ")}`);
  }

  #fetchPlugin(id: string, version: string): Promise<Buffer> {
    if (this.#ws?.readyState !== WebSocket.OPEN) return Promise.reject(new Error("서버와 연결이 끊겼습니다"));
    const key = `${id}@${version}`;
    return new Promise<Buffer>((ok, fail) => {
      const t = setTimeout(() => { this.#fetches.delete(key); fail(new Error("묶음을 받지 못했습니다(시간 넘김)")); }, PLUGIN_FETCH_MS);
      t.unref();
      this.#fetches.set(key, { ok: (b) => { clearTimeout(t); ok(b); }, fail: (e) => { clearTimeout(t); fail(e); } });
      this.#send({ t: "plugin-get", id, version });
    });
  }

  #ask(runId: string, body: { op: "callFlow"; req: CallFlowRequest } | { op: "file"; fn: FileFn; path: string; text?: string } | { op: "approval"; req: ApprovalRequest }): Promise<unknown> {
    if (this.#ws?.readyState !== WebSocket.OPEN) return Promise.reject(new Error("서버와 연결이 끊겼습니다"));
    const id = ++this.#seq;
    return new Promise((ok, fail) => {
      this.#asks.set(id, { ok, fail });
      this.#send({ t: "ask", id, runId, ...body } as FromWorker);
    });
  }

  /** 이 실행의 파일 — 서버에 맡긴다 */
  #files(runId: string): FileOps {
    const f = (fn: FileFn, path: string, text?: string) => this.#ask(runId, { op: "file", fn, path, ...(text !== undefined ? { text } : {}) });
    return {
      list: async (dir) => (await f("list", dir)) as string[],
      read: async (path) => (await f("read", path)) as string | null,
      write: async (path, text) => { await f("write", path, text); },
      // 바이트는 base64 글로 실어 보낸다(서버가 풀어 쓴다)
      writeBytes: async (path, data) => { await f("writeBytes", path, Buffer.from(data).toString("base64")); },
      // 압축은 파일이 있는 서버에서 — 묶을 것을 이 PC로 가져오지 않는다
      zip: async (src, include, dest, ifExists) => (await f("zip", src, JSON.stringify({ include, dest, ifExists }))) as { count: number; bytes: number },
      append: async (path, text) => { await f("append", path, text); },
      stat: async (path) => (await f("stat", path)) as Awaited<ReturnType<FileOps["stat"]>>,
      remove: async (path) => { await f("remove", path); },
    };
  }

  async #run(job: RunJob): Promise<void> {
    const ac = new AbortController();
    this.#running.set(job.runId, ac);
    // 화면 중계 — 서버에서 누가 볼 때만 보낸다(못 따라오면 버린다)
    const fid = runFrameId(job.runId);
    const relay = new ScreenRelay({
      frame: (jpeg) => { const ws = this.#ws; if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFERED) ws.send(packFrame(fid, jpeg), { binary: true }); },
      meta: (m) => this.#send({ t: "screen-out", runId: job.runId, m }),
    });
    this.#screens.set(job.runId, relay);
    this.#log(`실행 시작 — ${job.flow.name} (${job.runId.slice(0, 8)})`);
    try {
      const result = await this.#o.worker.run(job, (e) => this.#send({ t: "event", runId: job.runId, e }), {
        signal: ac.signal,
        onPage: (page) => relay.setPage(page),
        fileOps: this.#files(job.runId),
        callFlow: async (req) => (await this.#ask(job.runId, { op: "callFlow", req })) as CallFlowResult,
        approval: async ({ signal: _signal, ...req }) => (await this.#ask(job.runId, { op: "approval", req })) as ApprovalAnswer,
      });
      this.#send({ t: "done", runId: job.runId, result });
      this.#log(`실행 끝 — ${job.flow.name}: ${result.status}${result.message ? ` · ${result.message}` : ""}`);
    } catch (e) {
      this.#send({ t: "fail", runId: job.runId, message: e instanceof Error ? e.message.split("\n")[0]! : String(e) });
    } finally {
      this.#running.delete(job.runId);
      this.#screens.delete(job.runId);
      await relay.stop();
    }
  }

  // ─── 녹화 ─────────────────────────────────────────────────────────

  async #recOpen(sid: string, req: OpenRequest, secrets: Record<string, SecretValue>): Promise<void> {
    if (this.#recs.has(sid)) return;
    const rec: Rec = { session: null, closed: false, inputs: Promise.resolve() };
    this.#recs.set(sid, rec);
    const io = {
      send: (m: ServerMessage) => this.#send({ t: "rec-out", sid, m }),
      frame: (jpeg: Buffer) => { const ws = this.#ws; if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFERED) ws.send(packFrame(sid, jpeg), { binary: true }); },
    };
    this.#log(`녹화 시작 — ${req.draft?.name ?? req.flowId}`);
    try {
      // 사람의 크롬에 붙는 플로우면 이 PC의 크롬 · 지갑 브라우저면 이 PC의 MetaMask 크롬 · 앱 안 브라우저면 이 PC의 앱 ·
      // 아니면 이 PC에서 브라우저를 띄운다(데스크톱 앱이면 앱 안 브라우저로 — 사람이 바로 만진다)
      const browser = req.draft?.settings?.browser;
      const src = browser === "attach" ? { cdpUrl: this.#o.worker.cdpUrl ?? DEFAULT_CDP_URL }
        : browser === "wallet" ? await this.#o.worker.walletSource(req.draft, secrets, (text) => io.send({ t: "progress", text }), req.params ?? {})
        : browser === "app" || ((browser ?? "launch") === "launch" && !req.draft?.settings?.wallet && this.#o.worker.launchInApp) ? this.#o.worker.appSource(req.draft)
        : await this.#browser();
      // 재생 전에 세션을 받아 둔다 — 재생 중 사람 기다리기(로그인)의 입력이 닿게
      const s = await RecorderSession.open(src, req, secrets, io, (x) => { if (!rec.closed) rec.session = x; });
      if (rec.closed) { await s.close(); return; }
      rec.session = s;
    } catch (e) {
      io.send({ t: "notice", level: "error", text: `이 PC에서 녹화를 열 수 없습니다 — ${(e as Error).message.split("\n")[0]}` });
      io.send({ t: "phase", phase: "closed", message: "열지 못했습니다" });
      this.#recs.delete(sid);
      this.#send({ t: "rec-ended", sid });
    }
  }

  async #recClose(sid: string): Promise<void> {
    const r = this.#recs.get(sid);
    if (!r) return;
    this.#recs.delete(sid);
    r.closed = true;
    await r.session?.close().catch(() => undefined);
    this.#log("녹화 끝");
  }

  #browser(): Promise<Browser> {
    if (!this.#recBrowser) {
      this.#recBrowser = chromium.launch({ headless: this.#o.worker.headless }).then((b) => {
        b.on("disconnected", () => { this.#recBrowser = null; });
        return b;
      }, (e) => { this.#recBrowser = null; throw e; });
    }
    return this.#recBrowser;
  }

  #dropAll(why: string): void {
    for (const a of this.#asks.values()) a.fail(new Error(why));
    this.#asks.clear();
    for (const ac of this.#running.values()) ac.abort();
    for (const r of this.#screens.values()) void r.stop();
    this.#screens.clear();
    // 녹화도 닫는다 — Studio 쪽은 서버가 «연결이 끊겼습니다»로 닫았다
    for (const sid of [...this.#recs.keys()]) void this.#recClose(sid);
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#state = "closed";
    this.#dropAll("워커를 끕니다");
    const ws = this.#ws;
    this.#ws = null;
    if (ws && ws.readyState !== WebSocket.CLOSED) await new Promise<void>((r) => { ws.once("close", () => r()); ws.close(); setTimeout(r, 1000).unref(); });
    await Promise.all([...this.#recs.keys()].map((sid) => this.#recClose(sid)));
    const b = this.#recBrowser;
    this.#recBrowser = null;
    if (b) await (await b).close().catch(() => undefined);
    await this.#o.worker.close();
  }
}
