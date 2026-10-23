/**
 * **HTTP 라우터** — `node:http` 위의 작은 라우터. 의존성을 늘리지 않는다.
 *
 * 길(route) · 본문 읽기 · JSON 응답 · 같은 출처 검사 · 편집 화면(정적 파일) 내주기 · 오류 → `{ error, problems? }`.
 * 길들은 http/routes/*.ts가 영역마다 만든다.
 */
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { extname, resolve, sep } from "node:path";
import { RunInputError } from "@flowsmith/engine";
import { SecretOpenError } from "../storage/secret-box.ts";
import { StoreError } from "../storage/store.ts";
import { FilesError } from "../storage/files.ts";

export type Params = Record<string, string>;
export type Handler = (req: IncomingMessage, res: ServerResponse, p: Params, body: () => Promise<Record<string, unknown>>) => Promise<unknown> | unknown;
export interface Route { method: string; pattern: string; re: RegExp; keys: string[]; handler: Handler }

const MAX_BODY = 5 * 1024 * 1024;

export class HttpError extends Error {
  readonly status: number;
  readonly problems: readonly string[];
  /** 기계가 읽을 까닭 — 같은 상태 번호를 갈라야 할 때(예: 404 not-deployed). 오류 본문에 `reason`으로 실린다 */
  readonly reason: string | null;
  constructor(status: number, message: string, problems: readonly string[] = [], reason: string | null = null) {
    super(message);
    this.status = status;
    this.problems = problems;
    this.reason = reason;
  }
}

/** `/api/flows/:id` 꼴 — `:이름`은 p[이름]으로 온다 */
export function route(method: string, pattern: string, handler: Handler): Route {
  const keys: string[] = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k: string) => { keys.push(k); return "([^/]+)"; })}$`);
  return { method, pattern, re, keys, handler };
}

/** API 토큰으로 온 요청인가 — 쿠키가 아니라 머리글이라 브라우저가 저절로 붙이지 않는다(다른 출처여도 위조가 아니다) */
export const bearerOf = (req: IncomingMessage): string | null => {
  const m = /^Bearer\s+(fsa_\S+)$/i.exec(String(req.headers.authorization ?? ""));
  return m ? m[1]! : null;
};

/** 주소의 ?쿼리 */
export const query = (req: IncomingMessage): URLSearchParams => new URL(req.url ?? "", "http://x").searchParams;

export const positiveInt = (s: string, what: string): number => {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `${what}는 1 이상의 정수여야 합니다`);
  return n;
};

/** 같은 출처인가 — Origin이 없으면(브라우저가 아닌 도구) 받는다 */
export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, "요청이 너무 큽니다");
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  let v: unknown;
  try { v = JSON.parse(text); } catch { throw new HttpError(400, "JSON을 읽을 수 없습니다"); }
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "본문은 JSON 객체여야 합니다");
  return v as Record<string, unknown>;
}

function json(res: ServerResponse, status: number, v: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(v));
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2",
};

/** ★폴더 밖으로 못 나간다 — `..`나 절대 경로로 다른 파일을 읽게 하지 않는다 */
async function serveStatic(dir: string, pathname: string, res: ServerResponse): Promise<boolean> {
  const root = resolve(dir);
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = resolve(root, rel);
  if (file !== root && !file.startsWith(root + sep)) return false;
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      // 빌드 결과물은 이름에 해시가 붙는다 — index.html만 매번 새로
      "cache-control": rel === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

export interface ServeOptions {
  /** 길에 닿기 전에 — 누군지 붙이고 권한이 모자라면 던진다(auth/auth.ts) */
  guard?: (req: IncomingMessage, method: string, path: string) => void;
  /** https — 인증서 · 키(PEM). 없으면 http(앞단 프록시가 https를 맡을 때) */
  tls?: { cert: string | Buffer; key: string | Buffer };
}

/** 길들로 서버를 만든다 */
export function serve(routes: Route[], staticDir: string | null, opts: ServeOptions = {}): Server {
  const handler: RequestListener = async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const method = req.method ?? "GET";
    if (staticDir && !url.pathname.startsWith("/api/") && (method === "GET" || method === "HEAD")) {
      if (await serveStatic(staticDir, url.pathname, res)) return;
    }
    try {
      // ★다른 웹사이트가 이 로컬 서버로 실행 · 시크릿 넣기를 보내지 못하게 — 상태를 바꾸는 요청은 같은 출처만
      // ☆웹훅(/api/hooks/) · API 토큰(Bearer fsa_)은 서버끼리 부르는 길이라 출처를 보지 않는다 — 대신 토큰으로 막는다
      if (method !== "GET" && method !== "HEAD" && !url.pathname.startsWith("/api/hooks/") && !bearerOf(req) && !sameOrigin(req)) throw new HttpError(403, "다른 출처에서 온 요청은 받지 않습니다");
      opts.guard?.(req, method, url.pathname);
      const matches = routes.filter((r) => r.re.test(url.pathname));
      if (matches.length === 0) throw new HttpError(404, "없는 주소입니다");
      const r = matches.find((m) => m.method === method);
      if (!r) throw new HttpError(405, `${method}는 이 주소에서 쓸 수 없습니다`);
      const m = r.re.exec(url.pathname)!;
      const p = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
      const out = await r.handler(req, res, p, () => readBody(req));
      if (out === undefined) return;               // 스스로 응답한 경우(SSE · 내려받기)
      if (out === null) { res.writeHead(res.statusCode || 204); res.end(); return; }
      json(res, res.statusCode || 200, out);
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      if (e instanceof HttpError || e instanceof StoreError) {
        return json(res, e.status, { error: e.message, ...(e.problems.length ? { problems: e.problems } : {}), ...(e instanceof HttpError && e.reason ? { reason: e.reason } : {}) });
      }
      if (e instanceof RunInputError) return json(res, 400, { error: "실행할 수 없습니다", problems: e.problems });
      if (e instanceof FilesError) return json(res, e.status, { error: e.message });
      if (e instanceof SecretOpenError) return json(res, 500, { error: e.message });
      console.error(e);
      json(res, 500, { error: "서버 오류" });
    }
  };
  // https 서버도 node:http의 Server와 같은 모양으로 쓴다(listen · close · upgrade)
  return opts.tls ? (createHttpsServer({ cert: opts.tls.cert, key: opts.tls.key }, handler) as unknown as Server) : createServer(handler);
}
