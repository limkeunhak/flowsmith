/**
 * **Gemini로 부르기**(PLAN §42-2) — 화면은 Anthropic Messages 모양으로만 말한다. 여기서 Gemini generateContent 모양으로 바꿔 부르고,
 * 답을 다시 Messages 모양(content 블록 · stop_reason · usage)으로 돌려준다 — 화면의 도우미 반복(ai/agent.ts)은 그대로.
 *
 *   보내기   system → systemInstruction · user/assistant → user/model · text → { text } · tool_use → { functionCall }
 *            · tool_result → { functionResponse }(이름은 앞의 tool_use에서) · tools → functionDeclarations
 *   받기     { text }(생각 글은 뺀다) → text 블록 · { functionCall } → tool_use 블록 · usageMetadata → usage
 *   ★thoughtSignature — Gemini 3부터 함수 호출에 붙어 오고, 다음 요청의 그 자리에 **그대로** 돌려줘야 한다(빠지면 400).
 *     블록의 gemini_signature에 실어 화면이 들고 있다가 돌려보낸다(Anthropic으로 보낼 때는 뺀다)
 *   ★속을 정하지 않은 객체 칸(propose_flow의 flow 등)은 Gemini 스키마가 받지 않을 수 있다 — JSON 글자 칸으로 바꿔 묻고 받은 글자를 다시 푼다
 */

type Obj = Record<string, unknown>;
/** 다른 모델(Claude)이 만든 함수 호출에 붙이는 자리 값 — Gemini 3 문서의 «다른 모델에서 옮겨 온 기록» */
export const FOREIGN_SIGNATURE = "skip_thought_signature_validator";
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

export interface GeminiTools {
  declarations: Obj[];
  /** 도구 이름 → JSON 글자로 바꿔 물은 칸 이름 */
  jsonProps: Map<string, Set<string>>;
}

/** Anthropic의 도구 → Gemini functionDeclarations */
export function geminiTools(tools: readonly unknown[] | undefined): GeminiTools {
  const jsonProps = new Map<string, Set<string>>();
  const declarations = (tools ?? []).filter(isObj).map((t) => {
    const name = String(t["name"]);
    const schema = isObj(t["input_schema"]) ? t["input_schema"] : { type: "object", properties: {} };
    const props = isObj(schema["properties"]) ? schema["properties"] : {};
    const asJson = new Set<string>();
    const properties = Object.fromEntries(Object.entries(props).map(([k, v]) => {
      const p = isObj(v) ? v : {};
      if (p["type"] === "object" && !isObj(p["properties"])) {
        asJson.add(k);
        return [k, { type: "string", description: `${String(p["description"] ?? "")} — ★JSON 글자로(객체를 JSON.stringify한 것)`.trim() }];
      }
      return [k, p];
    }));
    jsonProps.set(name, asJson);
    return { name, description: String(t["description"] ?? ""), parameters: { type: "object", properties, ...(Array.isArray(schema["required"]) ? { required: schema["required"] } : {}) } };
  });
  return { declarations, jsonProps };
}

/** Messages → generateContent 본문 */
export function toGemini(req: { system: string; messages: unknown[]; tools?: readonly unknown[] }, maxTokens: number): { body: Obj; tools: GeminiTools } {
  const tools = geminiTools(req.tools);
  const nameOf = new Map<string, string>();
  const contents = req.messages.filter(isObj).map((m) => {
    const role = m["role"] === "assistant" ? "model" : "user";
    const blocks = typeof m["content"] === "string" ? [{ type: "text", text: m["content"] }] : Array.isArray(m["content"]) ? m["content"].filter(isObj) : [];
    const parts = blocks.flatMap((b): Obj[] => {
      const sig = typeof b["gemini_signature"] === "string" ? { thoughtSignature: b["gemini_signature"] } : {};
      if (b["type"] === "text") return String(b["text"] ?? "") ? [{ text: String(b["text"]), ...sig }] : [];
      if (b["type"] === "tool_use") {
        const name = String(b["name"]);
        nameOf.set(String(b["id"]), name);
        const input = isObj(b["input"]) ? { ...b["input"] } : {};
        for (const k of tools.jsonProps.get(name) ?? []) if (k in input && typeof input[k] !== "string") input[k] = JSON.stringify(input[k]);
        // ★서명이 없는 함수 호출 = 대화 중에 Claude에서 Gemini로 바꿨다(AI 창의 고르기) — Google이 다른 모델의 기록에 쓰라고 정해 둔 자리 값
        return [{ functionCall: { name, args: input }, ...("thoughtSignature" in sig ? sig : { thoughtSignature: FOREIGN_SIGNATURE }) }];
      }
      if (b["type"] === "tool_result") {
        const id = String(b["tool_use_id"]);
        const text = typeof b["content"] === "string" ? b["content"] : JSON.stringify(b["content"] ?? "");
        return [{ functionResponse: { name: nameOf.get(id) ?? "tool", response: b["is_error"] ? { error: text } : { result: text } } }];
      }
      return [];
    });
    return { role, parts };
  }).filter((c) => c.parts.length > 0);
  return {
    body: {
      systemInstruction: { parts: [{ text: req.system }] },
      contents,
      ...(tools.declarations.length ? { tools: [{ functionDeclarations: tools.declarations }] } : {}),
      generationConfig: { maxOutputTokens: maxTokens },
    },
    tools,
  };
}

/** generateContent 답 → Messages 모양 */
export function fromGemini(data: unknown, tools: GeminiTools): { content: Obj[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number } } {
  const d = isObj(data) ? data : {};
  const cand = Array.isArray(d["candidates"]) && isObj(d["candidates"][0]) ? d["candidates"][0] : {};
  const parts = isObj(cand["content"]) && Array.isArray(cand["content"]["parts"]) ? cand["content"]["parts"].filter(isObj) : [];
  let n = 0;
  const content = parts.flatMap((p): Obj[] => {
    const sig = typeof p["thoughtSignature"] === "string" ? { gemini_signature: p["thoughtSignature"] } : {};
    if (p["thought"] === true) return [];   // 생각 글 — 보이지 않는다
    if (isObj(p["functionCall"])) {
      const fc = p["functionCall"];
      const name = String(fc["name"]);
      const input: Obj = isObj(fc["args"]) ? { ...fc["args"] } : {};
      for (const k of tools.jsonProps.get(name) ?? []) {
        if (typeof input[k] === "string") { try { input[k] = JSON.parse(input[k] as string); } catch { /* 틀린 JSON — 화면의 검문소가 «객체가 아닙니다»로 돌려준다 */ } }
      }
      return [{ type: "tool_use", id: typeof fc["id"] === "string" && fc["id"] ? fc["id"] : `gemini-${Date.now().toString(36)}-${n++}`, name, input, ...sig }];
    }
    if (typeof p["text"] === "string" && p["text"]) return [{ type: "text", text: p["text"], ...sig }];
    return [];
  });
  const u = isObj(d["usageMetadata"]) ? d["usageMetadata"] : {};
  return {
    content,
    stop_reason: content.some((b) => b["type"] === "tool_use") ? "tool_use" : cand["finishReason"] === "MAX_TOKENS" ? "max_tokens" : "end_turn",
    usage: { input_tokens: Number(u["promptTokenCount"] ?? 0), output_tokens: Number(u["candidatesTokenCount"] ?? 0) + Number(u["thoughtsTokenCount"] ?? 0) },
  };
}

/** Anthropic으로 보낼 때 — Gemini 것(gemini_signature)은 뺀다(모르는 칸이면 Anthropic이 받지 않는다) */
export function forAnthropic(messages: unknown[]): unknown[] {
  return messages.map((m) => {
    if (!isObj(m) || !Array.isArray(m["content"])) return m;
    return { ...m, content: m["content"].map((b) => { if (!isObj(b) || !("gemini_signature" in b)) return b; const { gemini_signature: _s, ...rest } = b; return rest; }) };
  });
}
