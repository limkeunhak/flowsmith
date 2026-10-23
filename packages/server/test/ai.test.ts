/**
 * AI — 서버 쪽(run/ai.ts · PLAN §42): 키를 잠가 두고 · 모델을 대신 부르고 · 너무 잦으면 막고 · 누가 얼마나 썼는지만 남긴다.
 * ★키 · 주고받은 글은 응답 · DB 어디에도 평문으로 남지 않는다 · 모델 이름은 화면이 고르지 못한다.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InProcessWorker } from "@flowsmith/worker";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { caller } from "./helpers.ts";

const KEY = "sk-ant-api03-TESTKEY-abcdefghijklmnopqrstuvwxyz0123456789";
const sent: { url: string; headers: Record<string, string>; body: any }[] = [];
let reply: () => Response = () => Response.json({ content: [{ type: "text", text: "안녕하세요" }], stop_reason: "end_turn", usage: { input_tokens: 120, output_tokens: 8 } });
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  sent.push({ url: String(url), headers: Object.fromEntries(Object.entries(init?.headers ?? {})), body: JSON.parse(String(init?.body)) });
  return reply();
}) as typeof fetch;

let app: App;
let dir: string;
const call = caller(() => app.url);
const ask = () => call("POST", "/api/ai/messages", { system: "도우미", messages: [{ role: "user", content: "만들어 줘 — 비밀 메모 XYZZY" }], tools: [{ name: "propose_flow", input_schema: { type: "object" } }], flowId: "f1", model: "claude-haiku-5-5" });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-ai-"));
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), monitor: false, schedule: false, ai: { fetch: fakeFetch, retryDelaysMs: [0, 0] } });
});
afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("AI — 서버", () => {
  it("키가 없으면 «관리자가 넣어야» · 모양이 틀린 키는 받지 않는다", async () => {
    expect((await call("GET", "/api/ai")).body).toMatchObject({ enabled: true, ready: false, key: null, model: "claude-opus-5-5" });
    const r = await ask();
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/AI 키가 없습니다/);
    expect((await call("PUT", "/api/ai", { apiKey: "hello" })).status).toBe(400);
    expect((await call("PUT", "/api/ai", { model: "gpt-9" })).status).toBe(400);
  });

  it("★내 키(머리글)로 — 서버에 키가 없어도 · 저장 · 기록하지 않는다 · 모양이 틀리면 400", async () => {
    const mine = "sk-ant-api03-MINE-zyxwvutsrqponmlkjihgfedcba9876543210";
    const r = await call("POST", "/api/ai/messages", { system: "도우미", messages: [{ role: "user", content: "안녕" }] }, { "x-flowsmith-ai-key": mine });
    expect(r.status).toBe(200);
    expect(sent.at(-1)!.headers["x-api-key"]).toBe(mine);
    expect((await call("GET", "/api/ai")).body.key).toBeNull();
    const db = readFileSync(join(dir, "t.db")).toString("latin1") + (() => { try { return readFileSync(join(dir, "t.db-wal")).toString("latin1"); } catch { return ""; } })();
    expect(db).not.toContain(mine);
    expect((await call("POST", "/api/ai/messages", { system: "x", messages: [{ role: "user", content: "x" }] }, { "x-flowsmith-ai-key": "hello" })).status).toBe(400);
  });

  it("★키를 잠가 두고 대신 부른다 — 모델은 서버가 정한 것 · 키는 응답 · DB에 평문으로 없다", async () => {
    const s = (await call("PUT", "/api/ai", { apiKey: KEY, model: "claude-sonnet-5-5" })).body;
    expect(s).toMatchObject({ ready: true, key: "screen", model: "claude-sonnet-5-5" });
    expect(JSON.stringify(s)).not.toContain(KEY);
    const r = await ask();
    expect(r.status).toBe(200);
    expect(r.body.content[0].text).toBe("안녕하세요");
    const last = sent.at(-1)!;
    expect(last.url).toBe("https://api.anthropic.com/v1/messages");
    expect(last.headers["x-api-key"]).toBe(KEY);
    expect(last.headers["anthropic-version"]).toBe("2023-06-01");
    expect(last.body).toMatchObject({ model: "claude-sonnet-5-5", system: "도우미", tools: [{ name: "propose_flow" }] });
    expect(last.body.model).not.toBe("claude-haiku-5-5");   // 화면이 고른 모델은 듣지 않는다
    const db = readFileSync(join(dir, "t.db")).toString("latin1") + (() => { try { return readFileSync(join(dir, "t.db-wal")).toString("latin1"); } catch { return ""; } })();
    expect(db).not.toContain(KEY);
    expect(db).not.toContain("XYZZY");   // 주고받은 글은 남기지 않는다
    const st = (await call("GET", "/api/ai")).body;
    expect(st.usage[0]).toMatchObject({ calls: 2, inputTokens: 240, outputTokens: 16 });
  });

  it("★Gemini — 고른 AI · 모델로 generateContent를 부르고 Messages 모양으로 돌려준다 · 키 모양 · 모델 이름을 본다", async () => {
    const gkey = "AIzaSyTEST-abcdefghijklmnopqrstuvwxyz012345";
    reply = () => Response.json({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "propose_flow", args: { flow: "{\"name\":\"g\"}", summary: "s" } }, thoughtSignature: "SIG" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } });
    const body = { system: "도우미", messages: [{ role: "user", content: "만들어 줘" }], tools: [{ name: "propose_flow", input_schema: { type: "object", properties: { flow: { type: "object" }, summary: { type: "string" } } } }] };
    const r = await call("POST", "/api/ai/messages", body, { "x-flowsmith-ai-provider": "gemini", "x-flowsmith-ai-key": gkey, "x-flowsmith-ai-model": "gemini-3.8-flash" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "propose_flow", input: { flow: { name: "g" }, summary: "s" }, gemini_signature: "SIG" }] });
    const last = sent.at(-1)!;
    expect(last.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect(last.headers["x-goog-api-key"]).toBe(gkey);
    expect(last.body.systemInstruction).toEqual({ parts: [{ text: "도우미" }] });
    expect(last.body.tools[0].functionDeclarations[0].parameters.properties.flow.type).toBe("string");
    // 모델을 안 고르면 기본(gemini-3.8-flash) · 틀린 키 · 틀린 모델 · 모르는 AI
    await call("POST", "/api/ai/messages", body, { "x-flowsmith-ai-provider": "gemini", "x-flowsmith-ai-key": gkey });
    expect(sent.at(-1)!.url).toContain("/models/gemini-3.8-flash:generateContent");
    expect((await call("POST", "/api/ai/messages", body, { "x-flowsmith-ai-provider": "gemini", "x-flowsmith-ai-key": KEY })).body.error).toMatch(/Gemini \(Google\) API 키 모양이 아닙니다/);
    // ★새 형식 AQ.… 키도 받는다(2026부터 AI Studio가 이것만 낸다)
    const aq = "AQ.Ab8RN6LELexample_abcdefghijklmnopqrstuvwxyz-0123456789";
    expect((await call("POST", "/api/ai/messages", body, { "x-flowsmith-ai-provider": "gemini", "x-flowsmith-ai-key": aq })).status).toBe(200);
    expect(sent.at(-1)!.headers["x-goog-api-key"]).toBe(aq);
    expect((await call("POST", "/api/ai/messages", body, { "x-flowsmith-ai-provider": "gemini", "x-flowsmith-ai-key": gkey, "x-flowsmith-ai-model": "claude-opus-5-5" })).status).toBe(400);
    expect((await call("POST", "/api/ai/messages", body, { "x-flowsmith-ai-provider": "openai", "x-flowsmith-ai-key": gkey })).status).toBe(400);
    reply = () => new Response(JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }), { status: 400 });
    expect((await call("POST", "/api/ai/messages", body, { "x-flowsmith-ai-provider": "gemini", "x-flowsmith-ai-key": gkey })).body.error).toMatch(/Gemini 키를 확인하세요/);
    // AQ. 키를 Google이 받지 않는 계정 — 까닭을 알려 준다
    reply = () => new Response(JSON.stringify({ error: { code: 401, message: "Request had invalid authentication credentials.", status: "UNAUTHENTICATED", details: [{ reason: "ACCESS_TOKEN_TYPE_UNSUPPORTED" }] } }), { status: 401 });
    expect((await call("POST", "/api/ai/messages", body, { "x-flowsmith-ai-provider": "gemini", "x-flowsmith-ai-key": aq })).body.error).toMatch(/이 키 형식\(AQ\.…\)을 Gemini API에서 받지 않았습니다/);
    const st = (await call("GET", "/api/ai")).body;
    expect(st.providers.gemini).toMatchObject({ label: "Gemini (Google)", model: "gemini-3.8-flash", serverKey: null });
    expect(st.providers.gemini.models).toContain("gemini-3.5-flash-lite");
  });

  it("모델 쪽 오류 · 틀린 키는 사람 말로 · 끄면 403", async () => {
    reply = () => new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 });
    expect((await ask()).body.error).toMatch(/AI 키가 맞지 않습니다/);
    reply = () => new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 });
    expect((await ask()).body.error).toMatch(/AI가 답하지 못했습니다\(400\) — bad request/);
    reply = () => Response.json({ content: [], usage: {} });
    expect((await call("PUT", "/api/ai", { enabled: false })).body.ready).toBe(false);
    expect((await ask()).status).toBe(403);
    await call("PUT", "/api/ai", { enabled: true });
  });

  it("★붐비면(503 · 529 · 429) 두 번 더 해 본다 — 그래도 안 되면 «붐빕니다 · 다른 모델» · 기록은 한 번", async () => {
    const gkey = "AIzaSyTEST-abcdefghijklmnopqrstuvwxyz012345";
    const body = { system: "도우미", messages: [{ role: "user", content: "만들어 줘" }] };
    const gem = { "x-flowsmith-ai-provider": "gemini", "x-flowsmith-ai-key": gkey };
    const highDemand = () => new Response(JSON.stringify({ error: { code: 503, message: "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.", status: "UNAVAILABLE" } }), { status: 503 });
    const ok = () => Response.json({ candidates: [{ content: { role: "model", parts: [{ text: "됐습니다" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } });
    const before = (await call("GET", "/api/ai")).body.usage[0]?.calls ?? 0;
    // 두 번 붐비다가 세 번째에 답한다 → 사람은 오류를 보지 않는다
    let n = 0;
    reply = () => (++n <= 2 ? highDemand() : ok());
    const r1 = await call("POST", "/api/ai/messages", body, gem);
    expect(r1.status).toBe(200);
    expect(r1.body.content[0].text).toBe("됐습니다");
    expect(n).toBe(3);
    // 세 번 다 붐비면 — 사람 말로 · 다른 모델을 권한다 · 원문도 붙인다
    n = 0;
    reply = () => { n++; return highDemand(); };
    const r2 = await call("POST", "/api/ai/messages", body, gem);
    expect(n).toBe(3);
    expect(r2.status).toBe(503);
    expect(r2.body.error).toMatch(/Gemini \(Google\)가 지금 붐빕니다\(503\)[\s\S]*다른 모델을 고르세요[\s\S]*high demand/);
    // Claude의 과부하(529) · 한도(429)
    reply = () => new Response(JSON.stringify({ error: { message: "Overloaded" } }), { status: 529 });
    expect((await ask()).body.error).toMatch(/Claude \(Anthropic\)가 지금 붐빕니다\(529\)/);
    reply = () => new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });
    const r3 = await ask();
    expect(r3.status).toBe(429);
    expect(r3.body.error).toMatch(/사용 한도에 걸렸습니다\(429\)/);
    // 너무 오래 기다리라는 Retry-After면 다시 해 보지 않는다
    n = 0;
    reply = () => { n++; return new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503, headers: { "retry-after": "60" } }); };
    await call("POST", "/api/ai/messages", body, gem);
    expect(n).toBe(1);
    // 다시 해 본 것은 따로 세지 않는다 — 부르기 한 번에 기록 한 줄
    expect((await call("GET", "/api/ai")).body.usage[0].calls).toBe(before + 5);
    reply = () => Response.json({ content: [], usage: {} });
  });

  it("★1분에 20번까지 — 넘으면 429 · 너무 큰 요청은 413", async () => {
    reply = () => Response.json({ content: [], usage: {} });
    let last = 0;
    for (let i = 0; i < 25 && last !== 429; i++) last = (await ask()).status;
    expect(last).toBe(429);
    const big = await call("POST", "/api/ai/messages", { system: "x", messages: [{ role: "user", content: "가".repeat(700 * 1024) }] });
    expect([413, 429]).toContain(big.status);
  });
});
