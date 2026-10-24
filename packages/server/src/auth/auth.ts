/**
 * **로그인 · 권한** — 사내 서버형(PLAN §24). 여러 사람이 한 서버를 함께 쓴다.
 *
 *   역할   viewer 보는 사람 < runner 실행자(게시된 버전 돌리기 · 멈추기 · 점검) < editor 편집자(만들고 고치고 게시) < admin 관리자(사람)
 *   로그인 메일 + 비밀번호 → 세션 쿠키(HttpOnly · SameSite=Lax · https면 Secure). 서버에는 토큰의 **해시**만
 *   처음   사람이 하나도 없으면 서버가 **설정 토큰**을 콘솔에 찍는다 — 그 토큰으로 첫 관리자를 만든다
 *
 * ★권한은 길마다 흩지 않고 한 곳(needOf)에서 정한다 — 새 길을 더할 때 빠뜨리면 기본이 «편집자»다(닫힌 쪽으로).
 * ★로그인을 끄면(enabled: false) 지금처럼 혼자 쓴다 — 이 PC에만 열 때만(main.ts가 막는다).
 * ★팀 — 관리자가 아니면 내가 속한 팀의 플로우와 공용(팀 없음) 플로우만 보인다. 남의 팀 것은 **없는 것처럼**(404).
 *  플로우 · 실행 · 점검 길은 여기(check)서 한 번에 본다. 파일 · WebSocket은 그 길이 canSee*를 부른다.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";
import { bearerOf, HttpError } from "../http/router.ts";
import type { Store, UserRole, UserRow } from "../storage/store.ts";
import { verifyPassword } from "./passwords.ts";
import { ROLE_LABEL } from "@flowsmith/core";
import { hashToken, newToken } from "./tokens.ts";
import { visibleTo } from "../rules/teams.ts";

export const COOKIE = "flowsmith_session";
const RANK: Record<UserRole, number> = { viewer: 0, runner: 1, editor: 2, admin: 3 };
export { ROLE_LABEL };

export type Need = "public" | UserRole;

/** 이 요청에 필요한 역할 — 한 곳에서 */
export function needOf(method: string, path: string): Need {
  if (!path.startsWith("/api/")) return "public";                                  // 편집 화면(정적 파일)
  if (path.startsWith("/api/hooks/")) return "public";                             // 웹훅 — 토큰으로 막는다
  if (method === "POST" && (path === "/api/auth/login" || path === "/api/auth/setup")) return "public";
  if (method === "GET" && (path === "/api/auth/me" || path === "/api/openapi.json")) return "public";
  if (path === "/api/tokens" || path.startsWith("/api/tokens/")) return "viewer";   // 내 토큰 — 누구나 제 것만(routes/tokens.ts)
  if (path.startsWith("/api/users") || path.startsWith("/api/teams")) return "admin";
  if (method === "GET" || method === "HEAD") return "viewer";
  if (path.startsWith("/api/workers")) return "admin";                            // 워커 — 보기는 누구나, 바꾸기는 관리자
  if (path.startsWith("/api/plugins")) return "admin";
  if (path === "/api/ai") return "admin";                                         // AI 설정(키 · 모델) — 묻기(/api/ai/messages)는 편집자                            // 확장 플러그인 — 서버 권한으로 도는 코드를 올린다(사내 저장소 주소도)
  if (path.startsWith("/api/shared")) return "admin";                             // 팀 공용 값 — 여러 플로우의 시크릿을 정한다
  if (method === "POST" && (path === "/api/auth/logout" || path === "/api/auth/password")) return "viewer";
  // Suite 돌리기 · 멈추기 — 실행자(만들고 고치기는 편집자)
  if (method === "POST" && (/^\/api\/suites\/[^/]+\/runs$/.test(path) || /^\/api\/suite-runs\/[^/]+\/cancel$/.test(path))) return "runner";
  if (method === "POST" && (/^\/api\/flows\/[^/]+\/runs$/.test(path) || /^\/api\/runs\/[^/]+\/(cancel|rerun|approval)$/.test(path) || /^\/api\/flows\/[^/]+\/probes$/.test(path))) return "runner";
  return "editor";
}

export const allows = (role: UserRole, need: UserRole): boolean => RANK[role] >= RANK[need];


function cookieOf(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** 요청마다 누가 — 길(handler)이 꺼내 쓴다 */
const who = new WeakMap<IncomingMessage, UserRow>();
export const userOf = (req: IncomingMessage): UserRow | null => who.get(req) ?? null;
/** 기록에 남길 이름 — 로그인 없이 쓰면 null */
export const byOf = (req: IncomingMessage): string | null => who.get(req)?.email ?? null;
/** API 토큰으로 온 요청인가(쿠키가 아니라) */
export const byToken = (req: IncomingMessage): boolean => bearerOf(req) !== null;

export interface AuthOptions {
  enabled: boolean;
  /** 쿠키에 Secure — "auto"면 https(또는 앞단의 X-Forwarded-Proto: https)일 때만 */
  secureCookie?: boolean | "auto";
  /** 로그인 유지(시간) — 쓰는 동안 늘어난다 */
  sessionHours?: number;
}

export class Auth {
  readonly enabled: boolean;
  /** 사람이 하나도 없을 때만 — 첫 관리자를 만드는 열쇠(콘솔에만 찍힌다) */
  setupToken: string | null = null;
  readonly #store: Store;
  readonly #secure: boolean | "auto";
  readonly #hours: number;
  /** 로그인 실패 — 메일+주소마다 최근 실패 시각 */
  readonly #fails = new Map<string, number[]>();

  constructor(store: Store, opts: AuthOptions) {
    this.#store = store;
    this.enabled = opts.enabled;
    this.#secure = opts.secureCookie ?? "auto";
    this.#hours = opts.sessionHours ?? 12;
    if (this.enabled && store.countUsers() === 0) this.setupToken = newToken("", 18);
  }

  get needsSetup(): boolean { return this.enabled && this.#store.countUsers() === 0; }

  /** 들어온 요청을 본다 — 누군지 붙이고, 권한이 모자라면 던진다 */
  check(req: IncomingMessage, method: string, path: string): void {
    if (!this.enabled) return;
    const u = this.#current(req);
    if (u) who.set(req, u);
    const need = needOf(method, path);
    if (need === "public") return;
    if (!u) throw new HttpError(401, "로그인이 필요합니다");
    if (!allows(u.role, need)) throw new HttpError(403, `${ROLE_LABEL[need]} 이상만 할 수 있습니다(지금: ${ROLE_LABEL[u.role]})`);
    // ★API 토큰으로 비밀번호는 못 바꾼다 — 새는 토큰이 사람을 빼앗지 못하게(토큰 만들기도 막는다 — routes/tokens.ts)
    if (method === "POST" && path === "/api/auth/password" && byToken(req)) throw new HttpError(403, "API 토큰으로는 비밀번호를 바꿀 수 없습니다");
    // 팀 — 이 길이 다루는 플로우를 볼 수 있나
    const flowId = this.#flowOfPath(path);
    if (flowId !== null && !this.canSeeFlow(u, flowId)) throw new HttpError(404, "없는 워크플로우입니다");
  }

  /** 길이 다루는 플로우 — /api/flows/:id/… · /api/runs/:runId/… · /api/probes/:id */
  #flowOfPath(path: string): string | null {
    let m = /^\/api\/flows\/([^/]+)/.exec(path);
    if (m) return decodeURIComponent(m[1]!);
    m = /^\/api\/runs\/([^/]+)/.exec(path);
    if (m) return this.#store.runFlowId(decodeURIComponent(m[1]!));
    m = /^\/api\/probes\/([^/]+)/.exec(path);
    if (m) return this.#store.probeFlowId(decodeURIComponent(m[1]!));
    return null;
  }

  /** 볼 수 있는 팀 — null이면 전부(로그인 끔 · 관리자) */
  teamsFor(user: UserRow | null): Set<string> | null {
    if (!this.enabled || !user || user.role === "admin") return null;
    return new Set(this.#store.teamsOf(user.id).map((t) => t.id));
  }

  /** 이 사람이 이 플로우를 보나 — 공용(팀 없음)은 모두가 본다. 없는 플로우는 true(길이 404를 낸다) */
  canSeeFlow(user: UserRow | null, flowId: string): boolean {
    if (!this.enabled) return true;
    if (!user) return false;
    return visibleTo(this.teamsFor(user), this.#store.flowTeam(flowId));
  }

  /** WebSocket — 쿠키로 사람을 찾아 플로우 · 실행을 볼 수 있나 */
  canSeeFlowReq(req: IncomingMessage, flowId: string): boolean { return !this.enabled || this.canSeeFlow(this.#current(req), flowId); }
  canSeeRunReq(req: IncomingMessage, runId: string): boolean {
    if (!this.enabled) return true;
    const flowId = this.#store.runFlowId(runId);
    return flowId === null || this.canSeeFlow(this.#current(req), flowId);
  }

  /** WebSocket — 쿠키로 누군지 보고, 권한이 되면 true */
  checkUpgrade(req: IncomingMessage, need: UserRole): boolean {
    if (!this.enabled) return true;
    const u = this.#current(req);
    return u !== null && allows(u.role, need);
  }

  /** WebSocket으로 들어온 사람(로그인을 끈 서버면 null) — 개인 워커에서 녹화해도 되나(주인만) */
  upgradeUser(req: IncomingMessage): UserRow | null {
    return this.enabled ? this.#current(req) : null;
  }

  #current(req: IncomingMessage): UserRow | null {
    // API 토큰 — 머리글에 있으면 그것만 본다(쿠키로 넘어가지 않는다)
    const bearer = bearerOf(req);
    if (bearer) return this.#store.apiTokenUser(hashToken(bearer));
    const token = cookieOf(req);
    if (!token) return null;
    const h = hashToken(token);
    const s = this.#store.sessionUser(h);
    if (!s) return null;
    // 쓰는 동안은 늘린다 — 남은 시간이 절반 아래면
    const left = new Date(s.expiresAt).getTime() - Date.now();
    if (left < (this.#hours * 3_600_000) / 2) this.#store.extendSession(h, this.#expiry());
    return s.user;
  }

  #expiry(): string { return new Date(Date.now() + this.#hours * 3_600_000).toISOString(); }

  #isSecure(req: IncomingMessage): boolean {
    if (this.#secure !== "auto") return this.#secure;
    return Boolean((req.socket as TLSSocket).encrypted) || String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]!.trim() === "https";
  }

  /** 로그인을 연다 — 쿠키를 심는다 */
  open(req: IncomingMessage, res: ServerResponse, user: UserRow): void {
    const token = newToken("", 32);
    this.#store.insertSession(hashToken(token), user.id, this.#expiry());
    this.#store.touchLogin(user.id);
    this.#store.pruneSessions();
    const attrs = [`${COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.round(this.#hours * 3600)}`];
    if (this.#isSecure(req)) attrs.push("Secure");
    res.setHeader("set-cookie", attrs.join("; "));
  }

  close(req: IncomingMessage, res: ServerResponse): void {
    const token = cookieOf(req);
    if (token) this.#store.deleteSession(hashToken(token));
    res.setHeader("set-cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  /** 지금 이 요청의 세션 해시 — 비밀번호를 바꿀 때 «이 로그인만 남기고» */
  sessionHash(req: IncomingMessage): string | undefined { const t = cookieOf(req); return t ? hashToken(t) : undefined; }

  /**
   * ★**로그인 서버 잇는 자리** — 바깥 로그인 서버(사내 SSO · OIDC 등)가 «이 사람이 맞다»고 확인해 준 뒤 부른다.
   *  처음 온 사람은 «보는 사람»으로 만든다(관리자가 역할을 준다). 끈 사람은 들이지 않는다.
   *  지금은 아래 login(임시 — 메일 + 비밀번호)만 이 길을 쓰지 않고 직접 확인한다. 바깥 로그인을 이으면
   *  그 콜백 길이 signIn → open을 부르면 된다 — 권한 · 세션 · 기록은 그대로다.
   */
  signIn(identity: { email: string; name: string }): UserRow {
    const found = this.#store.userByEmail(identity.email);
    if (found) {
      if (found.disabled) throw new HttpError(403, "꺼 둔 사람입니다 — 관리자에게 물어보세요");
      const { pwHash: _, ...user } = found;
      return user;
    }
    // 바깥 로그인으로 처음 온 사람 — 비밀번호는 없다(이 서버에서 비밀번호로는 못 들어온다)
    return this.#store.insertUser({ email: identity.email, name: identity.name || identity.email, role: "viewer", pwHash: "external", mustChange: false });
  }

  /** 메일 + 비밀번호(임시 — 로그인 서버를 잇기 전까지) — 실패가 잦으면 잠시 막는다(5분에 5번) */
  async login(email: string, password: string, from: string): Promise<UserRow> {
    const key = `${email.trim().toLowerCase()}|${from}`;
    const now = Date.now();
    const recent = (this.#fails.get(key) ?? []).filter((t) => now - t < 5 * 60_000);
    if (recent.length >= 5) throw new HttpError(429, "로그인 실패가 많아 잠시 막았습니다 — 5분 뒤에 다시 해 보세요");
    const u = this.#store.userByEmail(email);
    const ok = u !== null && !u.disabled && await verifyPassword(password, u.pwHash);
    if (!ok) {
      this.#fails.set(key, [...recent, now]);
      throw new HttpError(401, "메일이나 비밀번호가 맞지 않습니다");
    }
    this.#fails.delete(key);
    const { pwHash: _, ...user } = u!;
    return user;
  }
}
