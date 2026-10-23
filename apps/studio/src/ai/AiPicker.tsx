/**
 * **AI 창의 AI · 모델 고르기**(사용자 요청 2026-10-22 «채팅 패널에서 선택하게») — 머리 띠 바로 아래 한 줄.
 *   «내 설정»과 같은 곳(localStorage · ai/key.ts)에 적는다 — 어느 쪽에서 바꿔도 다른 쪽이 따라간다(AI_CHOICE_EVENT).
 *   다음에 보내는 말부터 그 AI · 모델로 간다(대화 중간에 바꿔도 된다). 키를 넣는 일은 «내 설정»에서만.
 */
import { useEffect, useState } from "react";
import { api, type AiStatus } from "../api.ts";
import { AI_CHOICE_EVENT, AI_KEY_HINT, AI_PROVIDER_LIST, myAiKey, myAiModel, myAiProvider, setMyAiModel, setMyAiProvider, type AiProvider } from "./key.ts";

/** 바뀔 때마다 다시 그리게 — 고른 AI · 모델 */
export function useAiChoice(): { provider: AiProvider; model: string | null } {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    addEventListener(AI_CHOICE_EVENT, on);
    addEventListener("storage", on);   // 다른 탭에서 바꿨을 때
    return () => { removeEventListener(AI_CHOICE_EVENT, on); removeEventListener("storage", on); };
  }, []);
  const provider = myAiProvider();
  return { provider, model: myAiModel(provider) };
}

const SHORT: Record<AiProvider, string> = { anthropic: "Claude", gemini: "Gemini" };

export function AiPicker({ disabled }: { disabled?: boolean }) {
  const { provider, model } = useAiChoice();
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => { void api.aiStatus().then(setStatus, () => setStatus(null)); }, []);
  const ps = status?.providers[provider];
  const models = ps?.models ?? [];
  const noKey = status !== null && ps?.serverKey == null && myAiKey(provider) === null;
  return (
    <div className="ai-picker">
      <select aria-label="쓸 AI" value={provider} disabled={disabled} onChange={(e) => setMyAiProvider(e.target.value as AiProvider)} title={AI_KEY_HINT[provider].label}>
        {AI_PROVIDER_LIST.map((p) => <option key={p} value={p}>{SHORT[p]}{status && status.providers[p].serverKey == null && myAiKey(p) === null ? " (키 없음)" : ""}</option>)}
      </select>
      <select aria-label="모델" className="mono grow" value={model ?? ""} disabled={disabled} onChange={(e) => setMyAiModel(provider, e.target.value || null)}>
        <option value="">기본{ps ? ` (${ps.model})` : ""}</option>
        {models.map((m) => <option key={m} value={m}>{m}</option>)}
        {model !== null && !models.includes(model) && <option value={model}>{model}</option>}
      </select>
      <a href="#/me" className={noKey ? "ai-picker-set warn" : "ai-picker-set"} title="키 넣기 · 목록에 없는 모델 적기">{noKey ? "키 넣기" : "설정"}</a>
    </div>
  );
}
