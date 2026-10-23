/**
 * 서버 시험이 함께 쓰는 것 — API 부르기 · 될 때까지 기다리기.
 */

export interface Reply {
  status: number;
  /** JSON이면 읽은 값, 아니면(파일 · 엑셀) null */
  body: any;
  text: string;
  bytes: Uint8Array;
  headers: Headers;
  /** 받은 로그인 쿠키(「flowsmith_session=…」) — 없으면 null */
  cookie: string | null;
}

/**
 * API를 부르는 함수를 만든다 — base는 서버 주소(시험이 뜬 뒤에 정해지니 함수로 받는다).
 * 네 번째 값: 글자면 로그인 쿠키, 객체면 더 보낼 헤더
 */
export function caller(base: () => string) {
  return async (method: string, path: string, body?: unknown, extra: string | Record<string, string> = {}): Promise<Reply> => {
    const headers: Record<string, string> = { "content-type": "application/json", ...(typeof extra === "string" ? (extra ? { cookie: extra } : {}) : extra) };
    const r = await fetch(base() + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const bytes = new Uint8Array(await r.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* 파일 · 엑셀 */ }
    const set = r.headers.get("set-cookie");
    return { status: r.status, body: parsed, text, bytes, headers: r.headers, cookie: set ? set.split(";")[0]! : null };
  };
}

/** ok가 참이 될 때까지 기다린다 — ms를 넘으면 실패 */
export async function until(ok: () => boolean | Promise<boolean>, ms = 10_000, what = "기다리다 지쳤습니다"): Promise<void> {
  const t0 = Date.now();
  while (!(await ok())) {
    if (Date.now() - t0 > ms) throw new Error(what);
    await new Promise((r) => setTimeout(r, 50));
  }
}
