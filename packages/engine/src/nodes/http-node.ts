/**
 * **HTTP 요청 노드** (core nodes/http.ts) — 주소 · 쿼리 · 헤더 · 본문을 채워 보내고 `{ status, ok, body, headers }`를 내놓는다.
 *
 * ★JSON 본문은 JSON으로 먼저 읽고 글자 값 안에서만 채운다 — 값에 따옴표가 있어도 JSON이 깨지지 않는다.
 *  값 하나뿐인 글자(「"{{ $input.rows }}"」)는 그 값 그대로(숫자 · 목록 · 객체).
 * ★다시 해 보기는 GET · HEAD만 — 연결 실패 · 시간 초과 · 429 · 5xx일 때. POST는 두 번 보내면 두 건이 된다.
 * ★시크릿은 헤더 · 쿼리 · 본문에만 들어간다. 기록 · 로그에서는 실행기가 가린다(run.ts redact).
 */
import {
  evaluate, httpSafe, HTTP_MAX_RESPONSE_BYTES, isSingleRefTemplate,
  type HttpConfig, type HttpNode, type Output, type Scope,
} from "@flowsmith/core";
import { pause, RunStopped } from "../errors.ts";
import { BlockedAddressError, enginePolicy } from "../policy.ts";

export class HttpNodeError extends Error {
  constructor(message: string, name = "HttpNodeError") {
    super(message);
    this.name = name;
  }
}

export interface HttpEnv {
  scope: Scope;
  defaultTimeoutMs: number;
  retry?: { count: number; delayMs: number };
  signal?: AbortSignal;
  log: (text: string) => void;
  /** 시험용 — 진짜 fetch 대신 */
  fetch?: typeof fetch;
}

const asText = (v: unknown): string => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** 템플릿 하나 → 글자 */
function fill(template: string, scope: Scope): string {
  return asText(evaluate(template, scope).value);
}

/** JSON 본문 — 글자 값 안에서만 채운다 */
export function jsonBody(text: string, scope: Scope): string {
  if (text.trim() === "") return "";
  const one = (t: string): unknown => {
    const v = evaluate(t.trim(), scope).value;
    if (v === undefined) throw new HttpNodeError(`본문의 ${t.trim()} 값이 없습니다`);
    return v;
  };
  if (isSingleRefTemplate(text)) return JSON.stringify(one(text));
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return isSingleRefTemplate(v) ? one(v) : v.includes("{{") ? evaluate(v, scope).value : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return JSON.stringify(walk(JSON.parse(text)));
}

function buildRequest(c: HttpConfig, scope: Scope): { url: string; init: RequestInit & { headers: Headers } } {
  const noSecrets: Scope = { ...scope, secrets: {} };
  const raw = fill(c.url, noSecrets).trim();
  let url: URL;
  try { url = new URL(raw); } catch { throw new HttpNodeError(`주소를 읽을 수 없습니다 — ${raw || "(비어 있음)"}`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new HttpNodeError(`http · https 주소만 부릅니다 — ${raw}`);
  for (const q of c.query) url.searchParams.append(q.name, fill(q.value, scope));
  const headers = new Headers();
  for (const h of c.headers) {
    const v = fill(h.value, scope);
    // 헤더 값은 라틴 글자만 — 한글을 보내려면 본문이나 쿼리(인코딩된다)로
    if (/[^\t\x20-\xff]/.test(v)) throw new HttpNodeError(`헤더 '${h.name}' 값에 쓸 수 없는 글자(한글 · 줄바꿈 등)가 있습니다 — 한글은 쿼리나 본문으로 보내세요`);
    headers.append(h.name, v);
  }
  if (!headers.has("user-agent")) headers.set("user-agent", "Flowsmith");
  let body: string | undefined;
  switch (c.body.kind) {
    case "none": break;
    case "json":
      body = jsonBody(c.body.text, scope);
      if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
      break;
    case "text":
      body = fill(c.body.text, scope);
      if (!headers.has("content-type")) headers.set("content-type", "text/plain; charset=utf-8");
      break;
    case "form":
      body = new URLSearchParams(c.body.fields.map((f): [string, string] => [f.name, fill(f.value, scope)])).toString();
      if (!headers.has("content-type")) headers.set("content-type", "application/x-www-form-urlencoded");
      break;
  }
  return { url: url.toString(), init: { method: c.method, headers, ...(body !== undefined ? { body } : {}) } };
}

/** 본문을 읽는다 — 너무 크면 끊는다 */
async function readBody(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > HTTP_MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new HttpNodeError(`받은 본문이 너무 큽니다(${Math.round(HTTP_MAX_RESPONSE_BYTES / 1024 / 1024)}MB 넘음)`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseBody(text: string, res: Response, kind: HttpConfig["response"]): unknown {
  const json = kind === "json" || (kind === "auto" && /[/+]json\b/i.test(res.headers.get("content-type") ?? ""));
  if (!json) return text;
  if (text.trim() === "") return null;
  try { return JSON.parse(text); } catch {
    if (kind === "json") throw new HttpNodeError(`받은 본문을 JSON으로 읽을 수 없습니다 — ${text.slice(0, 120)}`);
    return text;
  }
}

/**
 * 보낸다 — 서버의 주소 지킴이(엔진 정책)가 있으면 부르기 전에 · 되돌려 보낼 때(3xx)마다 주소를 본다.
 * ☆되돌려 보내기를 따라가다 서버 안쪽 주소로 가지 않게 — 지킴이가 있으면 손으로 따라간다(5번까지)
 */
async function send(doFetch: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const guard = enginePolicy.httpGuard;
  if (!guard) return doFetch(url, { ...init, redirect: "follow" });
  let at = new URL(url);
  let req = init;
  for (let hop = 0; ; hop++) {
    await guard(at);
    const res = await doFetch(at.toString(), { ...req, redirect: "manual" });
    const loc = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !loc) return res;
    if (hop >= 5) throw new HttpNodeError(`되돌려 보내기가 너무 많습니다 — ${url}`);
    at = new URL(loc, at);
    // 307 · 308은 방법 · 본문을 그대로, 나머지는 GET으로(브라우저와 같다)
    if (res.status !== 307 && res.status !== 308) { const { body: _b, ...rest } = req; req = { ...rest, method: "GET" }; }
  }
}

/** 연결 실패의 까닭 — fetch는 「fetch failed」만 말한다 */
const why = (e: unknown): string => {
  const cause = (e as { cause?: { code?: string; message?: string } }).cause;
  return cause?.code ?? cause?.message ?? (e instanceof Error ? e.message : String(e));
};

const secs = (ms: number) => (ms >= 1000 ? `${Math.round(ms / 100) / 10}초` : `${ms}ms`);

export async function runHttpNode(node: HttpNode, env: HttpEnv): Promise<Output> {
  const c = node.config;
  const { url, init } = buildRequest(c, env.scope);
  const timeoutMs = c.timeoutMs ?? env.defaultTimeoutMs;
  const tries = httpSafe(c.method) ? (c.retries ?? env.retry?.count ?? 0) : 0;
  const doFetch = env.fetch ?? fetch;

  for (let attempt = 0; ; attempt++) {
    if (env.signal?.aborted) throw new RunStopped();
    const t0 = Date.now();
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = env.signal ? AbortSignal.any([env.signal, timeout]) : timeout;
    let again: string | null = null;
    try {
      const res = await send(doFetch, url, { ...init, signal });
      const text = c.method === "HEAD" ? "" : await readBody(res);
      env.log(`${c.method} ${url} → ${res.status}${res.statusText ? ` ${res.statusText}` : ""} (${secs(Date.now() - t0)})`);
      if ((res.status === 429 || res.status >= 500) && attempt < tries) again = `${res.status}`;
      else {
        if (!res.ok && c.failOn === "status") {
          throw new HttpNodeError(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""} — ${c.method} ${url}${text.trim() ? ` · ${text.trim().slice(0, 200)}` : ""}`);
        }
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => { headers[k] = v; });
        return { status: res.status, ok: res.ok, body: parseBody(text, res, c.response), headers };
      }
    } catch (e) {
      if (env.signal?.aborted) throw new RunStopped();
      if (e instanceof HttpNodeError) throw e;
      if (e instanceof BlockedAddressError) throw new HttpNodeError(e.message);
      const timedOut = timeout.aborted;
      const msg = timedOut ? `시간 안에 끝나지 않았습니다(${secs(timeoutMs)}) — ${c.method} ${url}` : `연결하지 못했습니다(${why(e)}) — ${c.method} ${url}`;
      if (attempt >= tries) throw new HttpNodeError(msg, timedOut ? "TimeoutError" : "HttpNodeError");
      again = msg;
    }
    env.log(`다시 해 봅니다(${attempt + 1}/${tries}) — ${again}`);
    await pause(env.retry?.delayMs ?? 2_000, env.signal);
  }
}
