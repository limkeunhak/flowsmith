/**
 * Gemini 바꾸기(run/ai-gemini.ts · PLAN §42-2) — Messages 모양 ↔ generateContent.
 * ★thoughtSignature는 받은 자리 그대로 돌려보낸다(Gemini 3 — 빠지면 400) · 속을 정하지 않은 객체 칸은 JSON 글자로 묻고 다시 푼다 · 생각 글은 안 보인다.
 */
import { describe, expect, it } from "vitest";
import { FOREIGN_SIGNATURE, forAnthropic, fromGemini, geminiTools, toGemini } from "../src/run/ai-gemini.ts";

const TOOLS = [{ name: "propose_flow", description: "제안", input_schema: { type: "object", properties: { flow: { type: "object", description: "워크플로우 전체" }, summary: { type: "string" } }, required: ["flow", "summary"] } }];

describe("Gemini로 바꾸기", () => {
  it("★도구 — 속이 없는 객체 칸은 JSON 글자 칸으로", () => {
    const t = geminiTools(TOOLS);
    expect(t.declarations).toEqual([{ name: "propose_flow", description: "제안", parameters: { type: "object", properties: { flow: { type: "string", description: "워크플로우 전체 — ★JSON 글자로(객체를 JSON.stringify한 것)" }, summary: { type: "string" } }, required: ["flow", "summary"] } }]);
    expect([...t.jsonProps.get("propose_flow")!]).toEqual(["flow"]);
  });

  it("★보내기 — system · 역할 · tool_use → functionCall(서명 그대로) · tool_result → functionResponse(이름은 앞에서)", () => {
    const { body } = toGemini({
      system: "도우미",
      tools: TOOLS,
      messages: [
        { role: "user", content: "만들어 줘" },
        { role: "assistant", content: [{ type: "text", text: "만들게요" }, { type: "tool_use", id: "c1", name: "propose_flow", input: { flow: { nodes: [] }, summary: "s" }, gemini_signature: "SIG_A" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "받지 못했습니다", is_error: true }] },
      ],
    }, 1000);
    expect(body["systemInstruction"]).toEqual({ parts: [{ text: "도우미" }] });
    expect(body["generationConfig"]).toEqual({ maxOutputTokens: 1000 });
    expect(body["contents"]).toEqual([
      { role: "user", parts: [{ text: "만들어 줘" }] },
      { role: "model", parts: [{ text: "만들게요" }, { functionCall: { name: "propose_flow", args: { flow: "{\"nodes\":[]}", summary: "s" } }, thoughtSignature: "SIG_A" }] },
      { role: "user", parts: [{ functionResponse: { name: "propose_flow", response: { error: "받지 못했습니다" } } }] },
    ]);
  });

  it("★대화 중에 Claude → Gemini로 바꾸면 — 서명 없는 함수 호출에 «다른 모델» 자리 값을 붙인다", () => {
    const { body } = toGemini({
      system: "도우미",
      tools: TOOLS,
      messages: [
        { role: "user", content: "만들어 줘" },
        { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "propose_flow", input: { flow: { nodes: [] }, summary: "s" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "적용함" }, { type: "text", text: "이제 Gemini로 — JSON으로 저장해 줘" }] },
      ],
    }, 1000);
    expect((body["contents"] as { parts: Record<string, unknown>[] }[])[1]!.parts[0]).toEqual({ functionCall: { name: "propose_flow", args: { flow: "{\"nodes\":[]}", summary: "s" } }, thoughtSignature: FOREIGN_SIGNATURE });
  });

  it("★받기 — functionCall → tool_use(JSON 글자는 다시 객체 · 서명은 gemini_signature) · 생각 글은 뺀다 · usage", () => {
    const tools = geminiTools(TOOLS);
    const out = fromGemini({
      candidates: [{ content: { role: "model", parts: [
        { text: "속으로 생각", thought: true },
        { text: "제안합니다" },
        { functionCall: { name: "propose_flow", args: { flow: "{\"name\":\"x\",\"nodes\":[{\"id\":\"a\"}]}", summary: "요약" } }, thoughtSignature: "SIG_B" },
      ] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5 },
    }, tools);
    expect(out.stop_reason).toBe("tool_use");
    expect(out.usage).toEqual({ input_tokens: 100, output_tokens: 25 });
    expect(out.content[0]).toEqual({ type: "text", text: "제안합니다" });
    expect(out.content[1]).toMatchObject({ type: "tool_use", name: "propose_flow", input: { flow: { name: "x", nodes: [{ id: "a" }] }, summary: "요약" }, gemini_signature: "SIG_B" });
    expect(String(out.content[1]!["id"])).toMatch(/^gemini-/);
    // 글만이면 end_turn
    expect(fromGemini({ candidates: [{ content: { parts: [{ text: "끝" }] }, finishReason: "STOP" }] }, tools).stop_reason).toBe("end_turn");
  });

  it("Anthropic으로 보낼 때는 gemini_signature를 뺀다", () => {
    expect(forAnthropic([{ role: "assistant", content: [{ type: "tool_use", id: "x", name: "n", input: {}, gemini_signature: "S" }] }, { role: "user", content: "안녕" }]))
      .toEqual([{ role: "assistant", content: [{ type: "tool_use", id: "x", name: "n", input: {} }] }, { role: "user", content: "안녕" }]);
  });
});
