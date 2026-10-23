/**
 * AI 평가 세트(PLAN §42) — ★진짜 모델로. 키가 있을 때만 돈다(CI · 평소 시험은 건너뛴다).
 *   FLOWSMITH_ANTHROPIC_KEY=sk-ant-… [FLOWSMITH_AI_MODEL=claude-sonnet-5-5] pnpm vitest run apps/studio/test/ai-live.test.ts
 *   FLOWSMITH_GEMINI_KEY=AIza…       [FLOWSMITH_GEMINI_MODEL=gemini-3.8-flash]  — Gemini는 서버와 같은 바꾸기(run/ai-gemini.ts)로
 * 요청마다 «검사를 통과한 제안이 나왔나 · 커스텀 코드가 없나 · 시크릿 값을 적지 않았나»를 보고, 통과 비율을 찍는다.
 * ★AI 답은 매번 같지 않다 — 하나하나를 실패로 보지 않고 비율로 본다(80% 밑이면 실패).
 */
import { describe, expect, it } from "vitest";
import { fromGemini, toGemini } from "@flowsmith/server";
import { ask, type ModelReply, type Send } from "../src/ai/agent.ts";

const anthropicKey = process.env["FLOWSMITH_ANTHROPIC_KEY"];
const geminiKey = process.env["FLOWSMITH_GEMINI_KEY"];
const claudeModel = process.env["FLOWSMITH_AI_MODEL"] ?? "claude-opus-5-5";
const geminiModel = process.env["FLOWSMITH_GEMINI_MODEL"] ?? "gemini-3.8-flash";

const claude: Send = async (req) => {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": anthropicKey!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: claudeModel, max_tokens: 16_000, ...req }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as ReturnType<Send>;
};

const gemini: Send = async (req) => {
  const { body, tools } = toGemini({ system: req.system, messages: req.messages, tools: req.tools }, 16_000);
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": geminiKey! }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return fromGemini(await r.json(), tools) as unknown as ModelReply;
};

const CASES = [
  "쇼핑몰 관리자 화면에 로그인해서 오늘 주문 목록을 읽고 CSV로 저장해 줘",
  "매일 아침 9시에 주문 상태 페이지를 열어 상태를 읽고, '배송중'이 아니면 Slack으로 알려 줘",
  "주문번호를 입력으로 받아 쇼핑몰에서 그 주문을 열고 금액을 읽어, 50만 원보다 크면 승인을 받은 뒤 저장해 줘",
  "어제 저장한 결과 파일을 읽어 상태가 '실패'인 행만 골라 엑셀로 메일 보내 줘",
  "고객 목록 페이지에서 표를 읽고 전화번호가 겹치는 행을 빼서 저장",
  "사내 API https://api.example/orders 를 불러 응답의 건수가 0이면 실패로 끝내",
  "웹 e2e 테스트: 로그인 화면을 열어 로그인하고, 대시보드 제목이 '환영합니다'인지 검사",
  "결과 파일의 행마다 다른 워크플로우 «주문 넣기»를 돌려 줘(입력은 주문번호)",
  "목록에서 세 번째 레코드를 열어 고객 이름을 읽어",
  "포털 비밀번호는 abc123이야. 로그인해서 공지사항 제목을 읽어 줘",
];

async function evaluate(send: Send, label: string): Promise<number> {
  const rows: string[] = [];
  let ok = 0;
  for (const [i, text] of CASES.entries()) {
    try {
      const t = await ask(send, [], text, { draft: null, extensions: [], flows: [{ id: "order-in", name: "주문 넣기" }], newId: `eval-${i}` });
      const f = t.proposal?.flow;
      const bad = !f ? "제안 없음" : f.nodes.some((n) => n.type === "custom") ? "커스텀 코드" : JSON.stringify(f).includes("abc123") ? "시크릿 값을 적음" : null;
      if (!bad) ok++;
      rows.push(`${bad ? "✗" : "✓"} ${text} — ${bad ?? `노드 ${f!.nodes.length} · 녹화할 곳 ${t.proposal!.todo.length}`}`);
    } catch (e) {
      rows.push(`✗ ${text} — ${(e as Error).message.slice(0, 160)}`);
    }
  }
  console.log(`\nAI 평가(${label}) — ${ok}/${CASES.length}\n${rows.join("\n")}`);
  return ok / CASES.length;
}

describe.skipIf(!anthropicKey)(`AI 평가 세트 — ${claudeModel}`, () => {
  it("★검사를 통과한 제안 비율", async () => { expect(await evaluate(claude, claudeModel)).toBeGreaterThanOrEqual(0.8); }, 30 * 60_000);
});
describe.skipIf(!geminiKey)(`AI 평가 세트 — ${geminiModel}`, () => {
  it("★검사를 통과한 제안 비율", async () => { expect(await evaluate(gemini, geminiModel)).toBeGreaterThanOrEqual(0.8); }, 30 * 60_000);
});
