/**
 * **워커 나눠 주기** (master — PLAN §26) — 실행을 서버 안(같은 프로세스 워커)이나 사람 PC의 워커에 보낸다.
 *
 * 젠킨스의 노드처럼:
 *   어디서     job.on — 없으면 서버 · 「worker:<id>」 그 워커 · 「label:<라벨>」 그 라벨이 붙은 워커 중 비어 있는 곳
 *   자리       워커마다 동시 실행 수(slots). 차면 줄을 선다(먼저 온 차례). ★부른 실행은 같은 워커의 부모 자리를 함께 쓴다
 *   못 가면    붙은 워커가 하나도 없으면 **기다리지 않고 바로 실패** — 일정이 조용히 쌓이지 않게, 알림이 바로 가게
 *   끊기면     돌던 실행은 «연결이 끊김»으로 실패 · 줄 선 것은 갈 곳이 없어졌으면 실패
 *
 * 워커가 실행 중에 묻는 것(ask): 다른 플로우 실행 → Runs의 callFlow · 파일 → **서버의 파일 뿌리**(그 실행이 닿는 폴더만).
 * ★연결은 워커 토큰(`Authorization: Bearer`)으로만 — 로그인 쿠키와 따로다.
 *
 * 확장 플러그인(PLAN §41): 켜 둔 목록을 워커에 알리고(plugins) 달라는 묶음을 준다(plugin-get). 워커가 다 실을 때까지(syncing)
 * 그 워커로는 일을 보내지 않고, ★실행에 필요한 확장이 없는 워커로는 보내지 않는다 — 갈 곳이 하나도 없으면 까닭을 말하고 실패.
 *
 * 녹화(PLAN §28): Studio의 녹화(/api/live)를 그 PC의 워커에 잇는다(record). 녹화는 실행 자리를 쓰지 않고,
 * **잠시 끈 워커에서도 된다**(실행은 받지 않고 녹화만 하는 PC). 팀이 맞아야 한다(풀린 시크릿이 간다).
 */
import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { localFileOps, rootedPath, type FileOps, type RunEvent, type RunResult } from "@flowsmith/engine";
import type { SecretValue } from "@flowsmith/core";
import type { ClientMessage, OpenRequest, ServerMessage } from "@flowsmith/recorder/protocol";
import { CLOSE, notRun, PROTOCOL, unpackFrame, type FromWorker, type RunHooks, type RunJob, type ToWorker, type WorkerClient, type WorkerPolicy } from "@flowsmith/worker";
import type { Store, WorkerInfo, WorkerRow } from "../storage/store.ts";
import { workerFits } from "../rules/teams.ts";
import { reject, type Upgrades } from "../live/upgrade.ts";
import { accepts, pick, unavailable } from "./placement.ts";
import type { Plugins } from "./plugins.ts";

interface Task {
  job: RunJob & { on: string };
  onEvent: (e: RunEvent) => void;
  hooks: RunHooks;
  resolve: (r: RunResult) => void;
  conn: Conn | null;
}

interface Conn {
  id: string;
  name: string;
  ws: WebSocket;
  info: WorkerInfo;
  connectedAt: string;
  running: Map<string, Task>;
  /** 이 워커에서 열린 녹화 — 세션 id → Studio 쪽 */
  recs: Map<string, RecIO>;
  alive: boolean;
  /** 플러그인을 받을 줄 아는 워커인가(hello) · 지금 받는 중인가 */
  pluginAware: boolean;
  syncing: boolean;
}

/** 이 실행에 필요한 확장 */
const needsOf = (job: RunJob): string[] => [...new Set(job.flow.nodes.flatMap((n) => (n.type === "extension" ? [n.config.extension] : [])))];

/** 녹화의 Studio 쪽 — 세션이 보내는 말 · 화면 */
export interface RecIO { send(m: ServerMessage): void; frame(jpeg: Buffer): void }
/** 원격 녹화 — LiveHub가 RecorderSession과 똑같이 다룬다 */
export interface Recording { input(m: ClientMessage): Promise<void>; close(): Promise<void> }

/** 한 번 읽은 워커 · 플로우의 팀 */
interface Snap { workers: WorkerRow[]; byId: Map<string, WorkerRow>; teamOf: (flowId: string) => string | null }

/** 워커 화면이 보는 지금 상태 */
export type { WorkerLive } from "../api-types.ts";
import type { WorkerLive } from "../api-types.ts";

const HELLO_MS = 10_000;
const HEARTBEAT_MS = 15_000;

export class WorkerHub implements WorkerClient {
  readonly #wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
  readonly #store: Store;
  readonly #local: WorkerClient;
  readonly #files: FileOps | null;
  readonly #policy: () => WorkerPolicy;
  readonly #plugins: Plugins | null;
  readonly #conns = new Map<string, Conn>();
  readonly #queue: Task[] = [];
  #timer: NodeJS.Timeout | null = null;

  constructor(store: Store, local: WorkerClient, opts: { filesDir?: string | null; policy: () => WorkerPolicy; plugins?: Plugins }) {
    this.#plugins = opts.plugins ?? null;
    this.#store = store;
    this.#local = local;
    this.#files = opts.filesDir ? localFileOps(opts.filesDir) : null;
    this.#policy = opts.policy;
  }

  attach(upgrades: Upgrades): void {
    upgrades.add(/^\/api\/workers\/connect$/, (req: IncomingMessage, socket: Duplex, head: Buffer) => {   // worker의 CONNECT_PATH
      const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
      const w = token ? this.#store.workerByToken(token) : null;
      if (!w) { reject(socket, 401); return; }
      this.#wss.handleUpgrade(req, socket, head, (ws) => this.#accept(w, ws));
    });
    this.#timer = setInterval(() => this.#heartbeat(), HEARTBEAT_MS);
    this.#timer.unref();
  }

  // ─── 연결 ─────────────────────────────────────────────────────────

  #accept(w: WorkerRow, ws: WebSocket): void {
    const hello = setTimeout(() => ws.close(CLOSE.protocol, "인사(hello)가 오지 않았습니다"), HELLO_MS);
    let conn: Conn | null = null;
    ws.on("message", (d, binary) => {
      if (binary) {
        // 녹화 화면 한 장 — [세션 id][JPEG]
        const f = conn ? unpackFrame(Buffer.isBuffer(d) ? d : Buffer.from(d as ArrayBuffer)) : null;
        if (f) conn!.recs.get(f.sid)?.frame(f.jpeg);
        return;
      }
      let m: FromWorker;
      try { m = JSON.parse(String(d)) as FromWorker; } catch { return; }
      if (conn) { this.#onMessage(conn, m); return; }
      if (m.t !== "hello") return;
      clearTimeout(hello);
      if (m.protocol !== PROTOCOL) { ws.close(CLOSE.protocol, `워커 프로그램의 버전이 서버와 다릅니다(서버 ${PROTOCOL} · 워커 ${m.protocol}) — 워커를 새로 받으세요`); return; }
      const info: WorkerInfo = { host: String(m.host).slice(0, 120), version: String(m.version).slice(0, 40), extensions: Array.isArray(m.extensions) ? m.extensions.map(String).slice(0, 100) : [] };
      // ★같은 워커가 다른 곳에서 붙었으면 옛 연결을 끊는다(PC를 다시 켰는데 옛 연결이 반쯤 살아 있을 때)
      const old = this.#conns.get(w.id);
      if (old) { old.ws.close(CLOSE.replaced, "같은 워커가 다른 곳에서 붙었습니다"); this.#drop(old); }
      const aware = m.plugins === true && this.#plugins !== null;
      conn = { id: w.id, name: w.name, ws, info, connectedAt: new Date().toISOString(), running: new Map(), recs: new Map(), alive: true, pluginAware: aware, syncing: aware };
      this.#conns.set(w.id, conn);
      this.#store.touchWorker(w.id, info);
      this.#send(conn, { t: "welcome", worker: { id: w.id, name: w.name }, policy: this.#policy() });
      if (aware) this.#send(conn, { t: "plugins", list: this.#plugins!.desired() });
      this.#pump();
    });
    ws.on("pong", () => { if (conn) conn.alive = true; });
    ws.on("close", () => { clearTimeout(hello); if (conn) this.#drop(conn); });
    ws.on("error", () => undefined);
  }

  #send(conn: Conn, m: ToWorker): void {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(m));
  }

  #heartbeat(): void {
    for (const c of this.#conns.values()) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false;
      c.ws.ping();
      this.#store.touchWorker(c.id);
    }
  }

  /** 연결이 끊겼다 — 돌던 것은 실패, 줄 선 것은 갈 곳이 없어졌으면 실패 */
  #drop(conn: Conn): void {
    if (this.#conns.get(conn.id) !== conn) return;
    this.#conns.delete(conn.id);
    this.#store.touchWorker(conn.id);
    for (const t of conn.running.values()) t.resolve(notRun(t.job, "failure", `워커 «${conn.name}»와 연결이 끊겼습니다 — 실행이 어디까지 됐는지 모릅니다. 그 PC에서 확인하세요`));
    conn.running.clear();
    for (const io of conn.recs.values()) {
      io.send({ t: "notice", level: "error", text: `워커 «${conn.name}»와 연결이 끊겨 녹화를 닫았습니다 — 그 PC의 워커 프로그램을 확인하세요` });
      io.send({ t: "phase", phase: "closed", message: "연결이 끊겼습니다" });
    }
    conn.recs.clear();
    this.refresh();
  }

  /** 켜 둔 플러그인이 바뀌었다 — 붙은 워커들에 알린다(다 실을 때까지 그 워커로는 보내지 않는다) */
  pluginsChanged(): void {
    if (!this.#plugins) return;
    const list = this.#plugins.desired();
    for (const c of this.#conns.values()) {
      if (!c.pluginAware) continue;
      c.syncing = true;
      this.#send(c, { t: "plugins", list });
    }
  }

  /** 워커를 끊는다 — 토큰을 바꿨거나 지웠을 때 */
  disconnect(id: string, why: string): void {
    const c = this.#conns.get(id);
    if (!c) return;
    c.ws.close(CLOSE.revoked, why);
    this.#drop(c);
  }

  // ─── 일 받기 ──────────────────────────────────────────────────────

  #onMessage(conn: Conn, m: FromWorker): void {
    switch (m.t) {
      case "event": conn.running.get(m.runId)?.onEvent(m.e); return;
      case "rec-out": conn.recs.get(m.sid)?.send(m.m); return;
      case "rec-ended": conn.recs.delete(m.sid); return;
      case "plugin-get": {
        const b = this.#plugins?.bytes(String(m.id), String(m.version)) ?? null;
        this.#send(conn, b ? { t: "plugin-data", id: m.id, version: m.version, ok: true, data: b.toString("base64") } : { t: "plugin-data", id: m.id, version: m.version, ok: false, error: `서버에 ${m.id} ${m.version} 묶음이 없습니다` });
        return;
      }
      case "extensions": {
        conn.info = { ...conn.info, extensions: Array.isArray(m.extensions) ? m.extensions.map(String).slice(0, 200) : [], plugins: m.plugins ?? {}, pluginErrors: m.errors ?? {} };
        conn.syncing = false;
        this.#store.touchWorker(conn.id, conn.info);
        this.#pump();
        return;
      }
      case "done":
      case "fail": {
        const t = conn.running.get(m.runId);
        if (!t) return;
        conn.running.delete(m.runId);
        t.resolve(m.t === "done" ? m.result : notRun(t.job, "failure", `실행기 오류(워커 «${conn.name}»): ${m.message}`));
        this.#pump();
        return;
      }
      case "ask": {
        const t = conn.running.get(m.runId);
        const reply = (p: Promise<unknown>) => p.then(
          (value) => this.#send(conn, { t: "reply", id: m.id, ok: true, value: value ?? null }),
          (e: unknown) => this.#send(conn, { t: "reply", id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) }),
        );
        if (!t) { void reply(Promise.reject(new Error("돌고 있는 실행이 아닙니다"))); return; }
        if (m.op === "callFlow") {
          void reply(t.hooks.callFlow ? t.hooks.callFlow(m.req) : Promise.reject(new Error("다른 워크플로우를 부를 수 없는 실행입니다")));
          return;
        }
        if (m.op === "approval") {
          // 멈춤은 cancel로 간다 — 서버 쪽 기다림은 그 실행이 끝날 때 걷힌다(run/runs.ts)
          void reply(t.hooks.approval ? t.hooks.approval({ ...m.req, signal: new AbortController().signal }) : Promise.reject(new Error("승인을 받을 수 없는 실행입니다")));
          return;
        }
        void reply(this.#file(t.job, m.fn, m.path, m.text));
        return;
      }
      default: return;
    }
  }

  /**
   * 워커의 파일 부탁 — 서버의 파일 뿌리에서. ★그 실행이 닿는 폴더만:
   * 읽기는 이 플로우 · 공유 · 이 실행이 읽기로 한 다른 플로우, 쓰기 · 지우기는 이 플로우 · 공유만
   */
  async #file(job: RunJob, fn: string, path: string, text: unknown): Promise<unknown> {
    if (!this.#files) throw new Error("서버에 파일 뿌리가 없습니다");
    const rel = rootedPath(String(path));
    const top = rel?.split("/")[0];
    const writable = new Set(["shared", ...(job.flowUid ? [job.flowUid] : [])]);
    const readable = new Set([...writable, ...Object.values(job.flowUids ?? {})]);
    const write = fn === "write" || fn === "append" || fn === "remove";
    if (!rel || !top || !(write ? writable : readable).has(top)) throw new Error(`「${path}」는 이 실행이 닿을 수 없는 폴더입니다`);
    const f = this.#files;
    switch (fn) {
      case "list": return f.list(rel);
      case "read": return f.read(rel);
      case "stat": return f.stat(rel);
      case "write": if (typeof text !== "string") throw new Error("쓸 글이 없습니다"); return f.write(rel, text);
      case "append": if (typeof text !== "string") throw new Error("쓸 글이 없습니다"); return f.append(rel, text);
      case "remove": return f.remove(rel);
      default: throw new Error(`모르는 파일 일입니다 — ${fn}`);
    }
  }

  // ─── 나눠 주기 ────────────────────────────────────────────────────

  run(job: RunJob, onEvent: (e: RunEvent) => void, hooks: RunHooks = {}): Promise<RunResult> {
    const on = job.on;
    if (!on) return this.#local.run(job, onEvent, hooks);
    return new Promise<RunResult>((resolve) => {
      const why = this.#unavailable(job.flow.id, on) ?? this.#lacking(job, on);
      if (why) { resolve(notRun(job, "failure", why)); return; }
      if (hooks.signal?.aborted) { resolve(notRun(job, "cancelled", "실행을 멈췄습니다")); return; }
      const task: Task = { job: { ...job, on }, onEvent, hooks, resolve, conn: null };
      hooks.signal?.addEventListener("abort", () => this.#cancel(task), { once: true });
      this.#queue.push(task);
      this.#pump();
      if (!task.conn) hooks.onQueued?.(this.#queue.indexOf(task));
    });
  }

  #cancel(task: Task): void {
    const i = this.#queue.indexOf(task);
    if (i >= 0) {
      this.#queue.splice(i, 1);
      task.resolve(notRun(task.job, "cancelled", "실행을 멈췄습니다(워커 차례를 기다리던 중)"));
      return;
    }
    if (task.conn) this.#send(task.conn, { t: "cancel", runId: task.job.runId });
  }

  /**
   * 한 번 읽은 것 — 워커 목록 · 플로우의 팀(물어본 것만 기억). 줄 하나를 돌리는 동안 · 화면 한 번 그리는 동안 쓴다.
   * ★플로우마다 · 워커마다 DB를 다시 묻지 않게(화면은 3초마다 · 줄은 일이 올 때마다)
   */
  #snapshot(): Snap {
    const workers = this.#store.listWorkers();
    const teams = new Map<string, string | null>();
    return {
      workers, byId: new Map(workers.map((w) => [w.id, w])),
      teamOf: (flowId) => { if (!teams.has(flowId)) teams.set(flowId, this.#store.flowTeam(flowId) ?? null); return teams.get(flowId)!; },
    };
  }

  /** 이 워커가 이 일을 받을 수 있나(자리는 따로) — run/placement.ts */
  #fits(w: WorkerRow, flowId: string, on: string, snap: Snap): boolean {
    return accepts(w, snap.teamOf(flowId), on);
  }

  /** 지금 갈 곳이 하나도 없으면 그 까닭 — run/placement.ts */
  #unavailable(flowId: string, on: string, snap: Snap = this.#snapshot()): string | null {
    return unavailable(on, snap.teamOf(flowId), snap.workers, (id) => this.#conns.has(id));
  }

  /**
   * 필요한 확장이 있는 워커가 없으면 그 까닭 — 받을 수 있는 워커가 붙어 있는데 아무도 그 확장을 싣지 않았을 때만.
   * ★받는 중(syncing)인 워커가 있으면 기다린다(올린 직후 · 막 붙은 워커)
   */
  #lacking(job: RunJob, on: string, snap: Snap = this.#snapshot()): string | null {
    const need = needsOf(job);
    if (need.length === 0) return null;
    const can = [...this.#conns.values()].filter((c) => { const w = snap.byId.get(c.id); return w !== undefined && this.#fits(w, job.flow.id, on, snap); });
    if (can.length === 0 || can.some((c) => c.syncing || need.every((x) => c.info.extensions.includes(x)))) return null;
    const missing = need.filter((x) => !can.some((c) => c.info.extensions.includes(x)));
    return `워커 «${can.map((c) => c.name).join(", ")}»에 확장 ${(missing.length ? missing : need).map((x) => `«${x}»`).join(", ")}이(가) 없습니다 — «확장» 화면에서 켜 두었는지, «워커» 화면에서 그 PC가 실었는지 보세요`;
  }

  /** 줄 선 것을 빈 자리에 — 먼저 온 차례. 갈 곳이 없어진 것은 실패로 */
  #pump(): void {
    if (this.#queue.length === 0) return;
    const snap = this.#snapshot();
    for (const task of [...this.#queue]) {
      const why = this.#unavailable(task.job.flow.id, task.job.on, snap) ?? this.#lacking(task.job, task.job.on, snap);
      if (why) { this.#queue.splice(this.#queue.indexOf(task), 1); task.resolve(notRun(task.job, "failure", why)); continue; }
      const conn = this.#pick(task, snap);
      if (!conn) continue;
      this.#queue.splice(this.#queue.indexOf(task), 1);
      task.conn = conn;
      conn.running.set(task.job.runId, task);
      task.hooks.onPlaced?.({ id: conn.id, name: conn.name });
      const { on: _on, ...job } = task.job;
      this.#send(conn, { t: "job", job });
    }
  }

  /** 보낼 연결 — run/placement.ts의 pick */
  #pick(task: Task, snap: Snap): Conn | null {
    // ★받는 중인 워커 · 필요한 확장이 없는 워커는 빼고
    const need = needsOf(task.job);
    const seats = [...this.#conns.values()].filter((c) => !(need.length > 0 && (c.syncing || !need.every((x) => c.info.extensions.includes(x)))))
      .map((c) => ({ id: c.id, running: c.running.size, has: (runId: string) => c.running.has(runId) }));
    const id = pick(task.job.on, snap.teamOf(task.job.flow.id), task.job.parentRunId, seats, snap.byId);
    return id ? this.#conns.get(id) ?? null : null;
  }

  // ─── 녹화 ─────────────────────────────────────────────────────────

  /**
   * 이 워커의 PC에서 녹화를 연다 — 못 열면 까닭(사람 말)을 던진다.
   * ★잠시 끈 워커도 된다 · 자리를 쓰지 않는다 · 팀이 맞아야 한다
   */
  record(workerId: string, req: OpenRequest, secrets: Record<string, SecretValue>, io: RecIO): Recording {
    const w = this.#store.findWorker(workerId);
    if (!w) throw new Error("녹화할 워커가 지워졌습니다 — 녹화 시작에서 PC를 다시 고르세요");
    if (!workerFits(w.team?.id ?? null, this.#store.flowTeam(req.flowId) ?? null)) throw new Error(`«${w.name}»는 ${w.team!.name} 전용 워커입니다 — 이 워크플로우는 그 PC에서 녹화할 수 없습니다`);
    const conn = this.#conns.get(workerId);
    if (!conn) throw new Error(`워커 «${w.name}»가 연결돼 있지 않습니다 — 그 PC에서 워커 프로그램을 켜세요`);
    const sid = randomBytes(8).toString("hex");
    conn.recs.set(sid, io);
    this.#send(conn, { t: "rec-open", sid, req, secrets });
    return {
      input: async (m) => { if (conn.recs.has(sid)) this.#send(conn, { t: "rec-input", sid, m }); },
      close: async () => { if (conn.recs.delete(sid)) this.#send(conn, { t: "rec-close", sid }); },
    };
  }

  /** 워커의 설정이 바뀌었다(잠시 끔 · 라벨 · 자리) — 줄을 다시 본다 */
  refresh(): void { this.#pump(); }

  /** 워커마다 지금 — 워커 화면 */
  live(): Map<string, WorkerLive> {
    const out = new Map<string, WorkerLive>();
    const snap = this.#snapshot();
    for (const w of snap.workers) {
      const c = this.#conns.get(w.id);
      out.set(w.id, {
        online: c !== undefined,
        connectedAt: c?.connectedAt ?? null,
        running: c ? [...c.running.values()].map((t) => ({ runId: t.job.runId, flowId: t.job.flow.id, flowName: t.job.flow.name })) : [],
        queued: this.#queue.filter((t) => this.#fits(w, t.job.flow.id, t.job.on, snap)).length,
        recording: c?.recs.size ?? 0,
      });
    }
    return out;
  }

  /** 지금 붙은 워커의 PC 정보(인사 때 받은 것) */
  info(id: string): WorkerInfo | null { return this.#conns.get(id)?.info ?? null; }

  async close(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    for (const t of this.#queue.splice(0)) t.resolve(notRun(t.job, "failure", "서버를 끕니다"));
    for (const c of [...this.#conns.values()]) { c.ws.close(1001, "서버를 끕니다"); this.#drop(c); }
    this.#wss.close();
    await this.#local.close();
  }
}
