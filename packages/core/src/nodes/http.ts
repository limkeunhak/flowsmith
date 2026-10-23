/**
 * **HTTP 요청 노드** — 다른 시스템의 API를 부른다(PLAN §15). 모은 값을 보내거나, 받은 값을 다음 노드로 넘긴다.
 *
 * ★표현식은 치환만 — JSON 본문은 JSON으로 먼저 읽고 **글자 값 안에서** 치환한다(따옴표가 깨지지 않게).
 *  값 하나뿐인 글자(「"{{ $input.rows }}"」)는 그 값 그대로 들어간다 — 숫자 · 목록 · 객체.
 * ★다시 해 보기는 GET · HEAD만(되돌릴 수 있는 동작만 다시 한다 — 운영 원칙). POST가 두 번 가면 두 건이 된다.
 * ★시크릿은 헤더 · 쿼리 값 · 본문에서만 — 주소에는 쓰지 않는다(주소는 기록에 남는다).
 */

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** 본문 — 없음 · JSON · 폼(이름=값) · 글자 */
export const HTTP_BODY_KINDS = ["none", "json", "form", "text"] as const;
export type HttpBodyKind = (typeof HTTP_BODY_KINDS)[number];

/** 받은 본문을 어떻게 읽나 — auto는 content-type을 보고 JSON이면 JSON */
export const HTTP_RESPONSE_KINDS = ["auto", "json", "text"] as const;
export type HttpResponseKind = (typeof HTTP_RESPONSE_KINDS)[number];

export interface HttpPair {
  name: string;
  /** 표현식 */
  value: string;
}

export interface HttpConfig {
  method: HttpMethod;
  /** http(s) 주소 — 표현식(시크릿 제외) */
  url: string;
  /** 주소 뒤에 붙일 쿼리 — 값은 알아서 인코딩한다 */
  query: HttpPair[];
  headers: HttpPair[];
  body: {
    kind: HttpBodyKind;
    /** json · text — 본문 글자 */
    text: string;
    /** form — 이름=값 */
    fields: HttpPair[];
  };
  response: HttpResponseKind;
  /** 4xx · 5xx면 — 노드가 실패한다(기본) · 그대로 넘긴다(status · ok로 조건 노드가 나눈다) */
  failOn: "status" | "never";
  /** 이 요청의 시간 제한 — null이면 플로우의 기본(defaultTimeoutMs) */
  timeoutMs: number | null;
  /** 다시 해 보기 — null이면 플로우 설정. ★GET · HEAD만 */
  retries: number | null;
}

export const HTTP_OUTPUTS = ["status", "ok", "body", "headers"] as const;
/** 받은 본문의 최대 크기 — 넘으면 실패한다(화면 · 기록이 무거워진다) */
export const HTTP_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** 다시 해 봐도 되는 요청인가 */
export const httpSafe = (m: HttpMethod): boolean => m === "GET" || m === "HEAD";

export function withHttpDefaults(c: Partial<HttpConfig> | undefined): HttpConfig {
  const b = (c?.body ?? {}) as Partial<HttpConfig["body"]>;
  return {
    method: c?.method ?? "GET", url: c?.url ?? "", query: c?.query ?? [], headers: c?.headers ?? [],
    body: { kind: b.kind ?? "none", text: b.text ?? "", fields: b.fields ?? [] },
    response: c?.response ?? "auto", failOn: c?.failOn ?? "status", timeoutMs: c?.timeoutMs ?? null, retries: c?.retries ?? null,
  };
}
