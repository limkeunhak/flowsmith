/**
 * **OpenAPI 명세** — 실제 등록된 길(router의 Route)과 설명(docs.ts)을 합쳐 만든다. 따로 적은 명세가 길과 어긋나지 않게.
 *
 *   필요한 역할   auth/auth.ts의 needOf — 서버가 실제로 막는 그대로
 *   인증          API 토큰(Authorization: Bearer fsa_…) · 로그인 쿠키(편집 화면) · 웹훅 토큰(/api/hooks)
 */
import { needOf, ROLE_LABEL } from "../auth/auth.ts";
import { DOCS, TAGS } from "./docs.ts";
import type { Route } from "./router.ts";

const ERROR = { $ref: "#/components/schemas/Error" };

/** 설명이 없는 길 · 길이 없는 설명 — 둘 다 비어야 한다(시험) */
export function drift(routes: readonly Route[]): { undocumented: string[]; stale: string[] } {
  const keys = new Set(routes.map((r) => `${r.method} ${r.pattern}`));
  return { undocumented: [...keys].filter((k) => !DOCS[k]), stale: Object.keys(DOCS).filter((k) => !keys.has(k)) };
}

export function openapi(routes: readonly Route[], opts: { auth: boolean }): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const doc = DOCS[`${r.method} ${r.pattern}`];
    if (!doc) continue;   // 시험이 잡는다(test/openapi.test.ts)
    const path = r.pattern.replace(/:(\w+)/g, "{$1}");
    const need = needOf(r.method, r.pattern.replace(/:(\w+)/g, "x"));
    const hook = r.pattern.startsWith("/api/hooks/");
    const body = doc.body ?? (doc.example !== undefined ? {} : null);
    const required = Object.keys(doc.body ?? {}).filter((k) => k.startsWith("*")).map((k) => k.slice(1));
    const ok = String(doc.ok ?? 200);
    const okContent = doc.produces === "sse" ? { "text/event-stream": { schema: { type: "string" } } }
      : doc.produces === "file" ? { "application/octet-stream": { schema: { type: "string", format: "binary" } } }
      : ok === "204" ? undefined : { "application/json": { schema: {} } };
    const roleNote = !opts.auth ? "로그인을 끈 서버 — 누구나" : need === "public" ? (hook ? "웹훅 토큰" : "로그인 없이") : `필요한 역할: ${ROLE_LABEL[need]} 이상`;
    (paths[path] ??= {})[r.method.toLowerCase()] = {
      tags: [doc.tag],
      summary: doc.summary,
      description: [doc.description, `**${roleNote}**`].filter(Boolean).join("\n\n"),
      operationId: `${r.method.toLowerCase()}${r.pattern.replace(/^\/api/, "").replace(/[/:.-](\w)/g, (_, c: string) => c.toUpperCase())}`,
      parameters: [
        ...r.keys.map((k) => ({ name: k, in: "path", required: true, schema: { type: "string" } })),
        ...Object.entries(doc.query ?? {}).map(([k, d]) => ({ name: k.replace(/^\*/, ""), in: "query", required: k.startsWith("*"), description: d, schema: { type: "string" } })),
        ...(doc.etag ? [{ name: "If-None-Match", in: "header", required: false, description: "받아 둔 것의 ETag — 같으면 304", schema: { type: "string" } }] : []),
      ],
      ...(body !== null && r.method !== "GET" ? {
        requestBody: {
          required: required.length > 0,
          content: { "application/json": {
            schema: { type: "object", ...(required.length ? { required } : {}), properties: Object.fromEntries(Object.entries(body).map(([k, d]) => [k.replace(/^\*/, ""), { description: d }])) },
            ...(doc.example !== undefined ? { example: doc.example } : {}),
          } },
        },
      } : {}),
      responses: {
        [ok]: { description: "됨", ...(okContent ? { content: okContent } : {}), ...(doc.etag ? { headers: { ETag: { schema: { type: "string" }, description: "다음에 If-None-Match로 보낸다" } } } : {}) },
        ...(doc.etag ? { "304": { description: "안 바뀜 — 받아 둔 것을 그대로 쓴다(본문 없음)" } } : {}),
        "400": { description: "잘못된 요청", content: { "application/json": { schema: ERROR } } },
        ...(need !== "public" && opts.auth ? {
          "401": { description: "로그인 · 토큰이 없다 · 끝났다", content: { "application/json": { schema: ERROR } } },
          "403": { description: "역할이 모자란다", content: { "application/json": { schema: ERROR } } },
        } : {}),
        "404": { description: "없다(남의 팀 것도)", content: { "application/json": { schema: ERROR } } },
      },
      security: hook ? [{ webhookToken: [] }] : need === "public" || !opts.auth ? [] : [{ apiToken: [] }, { session: [] }],
    };
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "Flowsmith API",
      version: "1",
      description: [
        "Flowsmith를 밖에서 조회하고 제어한다 — 워크플로우 · 실행 · 점검 · 워커 · 대시보드.",
        opts.auth ? "**인증**: API 토큰을 `Authorization: Bearer fsa_…`로(«API» 화면에서 만든다). 편집 화면에서는 로그인 쿠키로 바로 «Try it out»." : "**로그인을 끈 서버** — 토큰 없이 부른다.",
        "오류는 언제나 `{ error, problems?, reason? }`.",
      ].join("\n\n"),
    },
    servers: [{ url: "/" }],
    tags: TAGS,
    components: {
      securitySchemes: {
        apiToken: { type: "http", scheme: "bearer", description: "«API» 화면에서 만든 토큰(fsa_…)" },
        session: { type: "apiKey", in: "cookie", name: "flowsmith_session", description: "편집 화면의 로그인" },
        webhookToken: { type: "apiKey", in: "header", name: "x-flowsmith-token", description: "워크플로우의 웹훅 토큰(fsk_…)" },
      },
      schemas: {
        Error: { type: "object", properties: { error: { type: "string" }, problems: { type: "array", items: { type: "string" } }, reason: { type: "string", description: "기계가 읽는 까닭(예: not-deployed)" } }, required: ["error"] },
      },
    },
    paths,
  };
}
