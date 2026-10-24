/**
 * 서버 ↔ 워커 연결의 말 — WebSocket 하나에 JSON 한 덩이씩.
 *
 * ★연결은 **워커가 서버로** 건다(사람 PC는 사내망 안쪽 — 서버가 PC로 들어갈 수 없다). 토큰은 `Authorization: Bearer`.
 * ★시크릿이 이 연결로 오간다 — 이 PC 밖이면 https(wss)만(main.ts가 막는다).
 *
 *   워커 → 서버   hello(이 PC · 확장) · event · done · fail · ask(다른 플로우 실행 · 파일 · 승인)
 *   서버 → 워커   welcome(이름 · 정책) · job · cancel · reply(ask의 답)
 *
 * 확장 플러그인(2026-10-20, PLAN §41) — hello에 plugins: true면 서버가 켜 둔 목록을 알린다.
 *   서버 → 워커   plugins(id · 버전 · 해시) · plugin-data(달라는 묶음, base64)
 *   워커 → 서버   plugin-get(이 묶음을 달라) · extensions(다 싣고 난 뒤 — 실은 확장 · 버전 · 못 실은 까닭)
 *
 * 녹화(2026-10-17, PLAN §28) — 이 PC의 크롬에서 녹화한다. 서버는 Studio(/api/live)와 여기 사이를 잇기만 한다.
 *   서버 → 워커   rec-open(녹화 세션 열기 · 풀린 시크릿) · rec-input(Studio의 입력) · rec-close
 *   워커 → 서버   rec-out(세션이 Studio에 보내는 말) · rec-ended(세션이 닫혔다) · 이진 = 화면 한 장(앞에 세션 id)
 */
import type { SecretValue } from "@flowsmith/core";
import type { CallFlowRequest, RunEvent, RunResult } from "@flowsmith/engine";
import type { ClientMessage, OpenRequest, ServerMessage } from "@flowsmith/recorder/protocol";
import type { RunJob } from "./job.ts";
import type { PluginRef } from "./plugin-cache.ts";

export const PROTOCOL = 1;
export const CONNECT_PATH = "/api/workers/connect";

/** 서버가 정한 실행 정책 — 워커도 그대로 따른다(커스텀 코드 · HTTP 주소 지킴이) */
export interface WorkerPolicy {
  customCode: boolean;
  httpGuard: boolean;
  httpDeny: string[];
}

export type FileFn = "list" | "read" | "write" | "append" | "stat" | "remove";

export type ToWorker =
  | { t: "welcome"; worker: { id: string; name: string }; policy: WorkerPolicy }
  | { t: "job"; job: RunJob }
  | { t: "cancel"; runId: string }
  | { t: "reply"; id: number; ok: true; value: unknown }
  | { t: "reply"; id: number; ok: false; error: string }
  | { t: "rec-open"; sid: string; req: OpenRequest; secrets: Record<string, SecretValue> }
  | { t: "rec-input"; sid: string; m: ClientMessage }
  | { t: "rec-close"; sid: string }
  | { t: "plugins"; list: PluginRef[] }
  | { t: "plugin-data"; id: string; version: string; ok: true; data: string }
  | { t: "plugin-data"; id: string; version: string; ok: false; error: string };

/** 승인 기다리기 — 엔진의 ApprovalAsk에서 signal을 뺀 것(멈춤은 cancel로 간다) */
export interface ApprovalRequest { nodeId: string; message: string; minRole: "runner" | "editor" | "admin"; deadline: string }

export type FromWorker =
  /** plugins — 플러그인을 받을 줄 아는 워커(옛 워커는 없다 — 그 PC의 확장만 쓴다) */
  /** capabilities — 이 워커가 할 수 있는 일(wallet: 지갑 브라우저 · PLAN §44). 옛 워커는 보내지 않는다 */
  | { t: "hello"; protocol: number; host: string; version: string; extensions: string[]; plugins?: boolean; capabilities?: string[] }
  | { t: "event"; runId: string; e: RunEvent }
  | { t: "done"; runId: string; result: RunResult }
  /** 엔진 밖의 사고 — 브라우저가 못 뜬다 등 */
  | { t: "fail"; runId: string; message: string }
  | { t: "ask"; id: number; runId: string; op: "callFlow"; req: CallFlowRequest }
  | { t: "ask"; id: number; runId: string; op: "file"; fn: FileFn; path: string; text?: string }
  /** 승인 기다리기 — 서버가 사람에게 묻고 답(ApprovalAnswer)을 돌려준다 */
  | { t: "ask"; id: number; runId: string; op: "approval"; req: ApprovalRequest }
  | { t: "rec-out"; sid: string; m: ServerMessage }
  | { t: "rec-ended"; sid: string }
  | { t: "plugin-get"; id: string; version: string }
  | { t: "extensions"; extensions: string[]; plugins: Record<string, string>; errors: Record<string, string> };

/** 화면 한 장(이진) — [세션 id 길이 1바이트][세션 id][JPEG] */
export function packFrame(sid: string, jpeg: Buffer): Buffer {
  const id = Buffer.from(sid, "utf8");
  return Buffer.concat([Buffer.from([id.length]), id, jpeg]);
}
export function unpackFrame(b: Buffer): { sid: string; jpeg: Buffer } | null {
  if (b.length < 2) return null;
  const n = b[0]!;
  if (b.length < 1 + n) return null;
  return { sid: b.subarray(1, 1 + n).toString("utf8"), jpeg: b.subarray(1 + n) };
}

/** 서버가 연결을 닫을 때의 까닭 — 워커가 다시 붙을지 정한다 */
export const CLOSE = {
  /** 토큰이 바뀌었다 · 워커가 지워졌다 — 다시 붙지 않는다 */
  revoked: 4001,
  /** 같은 워커가 다른 곳에서 붙었다 */
  replaced: 4002,
  /** 말이 다르다(버전) */
  protocol: 4003,
} as const;
