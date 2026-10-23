/**
 * **내 설정**(#/me) — 이 사람 · 이 브라우저의 설정. 지금은 AI 도우미 — 어느 AI(Claude · Gemini) · 그 키 · 모델(ai/key.ts).
 * ★키는 이 브라우저에만 — 서버에는 저장하지 않는다(사용자 결정 2026-10-21 · 나중에 서버로 옮긴다).
 */
import { useEffect, useState } from "react";
import { api, type AiStatus } from "../api.ts";
import { AI_CHOICE_EVENT, AI_KEY_HINT, AI_KEY_RE, AI_MODEL_RE, AI_PROVIDER_LIST, maskKey, myAiKey, myAiModel, myAiProvider, setMyAiKey, setMyAiModel, setMyAiProvider, type AiProvider } from "../ai/key.ts";
import { useMe } from "./me.ts";

const OTHER = "__other__";

export function MySettings() {
  const me = useMe();
  const [provider, setProvider] = useState<AiProvider>(myAiProvider);
  const [tick, setTick] = useState(0);
  const [key, setKey] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [custom, setCustom] = useState("");
  useEffect(() => { void api.aiStatus().then(setStatus, () => undefined); }, []);
  // AI 창의 고르기에서 바꾸면 여기도 따라간다
  useEffect(() => {
    const on = () => { setProvider(myAiProvider()); setTick((t) => t + 1); };
    addEventListener(AI_CHOICE_EVENT, on);
    return () => removeEventListener(AI_CHOICE_EVENT, on);
  }, []);
  const saved = myAiKey(provider);
  const info = AI_KEY_HINT[provider];
  const ps = status?.providers[provider];
  const models = ps?.models ?? [];
  const chosen = myAiModel(provider);
  const modelValue = chosen === null ? "" : models.includes(chosen) ? chosen : OTHER;
  const bad = key.trim() !== "" && !AI_KEY_RE[provider].test(key.trim());
  const refresh = (t: string) => { setNote(t); setTick(tick + 1); };
  void tick;

  return (
    <div className="page">
      <div className="page-head"><h1 className="grow">내 설정</h1></div>
      <div className="page-sub">{me.user ? `${me.user.name}님의 설정입니다.` : "이 브라우저에서 쓰는 설정입니다."}</div>
      <div className="card stack my-settings">
        <h2>AI 도우미</h2>
        <span className="small muted">오른쪽 아래 «✦ AI» 창이 고른 AI를 부릅니다(AI · 모델은 그 창 위쪽에서도 바꿀 수 있습니다). 키는 <b>이 브라우저에만</b> 저장되고, AI를 부를 때만 서버를 거쳐 그 회사에 전달됩니다(서버는 저장하지 않습니다).</span>
        {status && !status.enabled && <div className="banner warn small">관리자가 AI를 꺼 두었습니다 — 키를 넣어도 쓸 수 없습니다.</div>}

        <div className="field"><span>쓸 AI</span>
          <div className="seg-tabs ai-provider" role="radiogroup" aria-label="쓸 AI">
            {AI_PROVIDER_LIST.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={provider === p} className={provider === p ? "on" : ""}
                onClick={() => { setProvider(p); setMyAiProvider(p); setKey(""); setCustom(""); refresh(`${AI_KEY_HINT[p].label}를 씁니다`); }}>
                {AI_KEY_HINT[p].label}{myAiKey(p) ? " ✓" : ""}
              </button>
            ))}
          </div>
        </div>

        {ps?.serverKey && !saved && <div className="banner small">서버에 정해 둔 {info.label} 키가 있어 넣지 않아도 됩니다. 내 키를 넣으면 내 키를 먼저 씁니다.</div>}
        <div className="row small">
          <span className="muted">{info.label} 키</span>
          {saved ? <><span className="pill mono">{maskKey(saved)}</span><button className="small ghost danger" onClick={() => { setMyAiKey(provider, null); refresh("키를 지웠습니다"); }}>지우기</button></> : <span className="muted">넣은 키 없음</span>}
        </div>
        <form className="row" onSubmit={(e) => {
          e.preventDefault();
          const v = key.trim();
          if (!AI_KEY_RE[provider].test(v)) return;
          setMyAiKey(provider, v);
          setKey("");
          refresh(myAiKey(provider) ? "키를 저장했습니다 — 이제 AI 도우미를 쓸 수 있습니다" : "이 브라우저는 저장소가 막혀 있어 키를 둘 수 없습니다(사생활 창 등)");
        }}>
          <input type="password" className="mono grow" autoComplete="off" placeholder={info.hint} value={key} aria-label={`${info.label} API 키`} onChange={(e) => { setKey(e.target.value); setNote(null); }} />
          <button className="primary" disabled={!AI_KEY_RE[provider].test(key.trim())}>{saved ? "바꾸기" : "저장"}</button>
        </form>
        {bad && <span className="small" style={{ color: "var(--bad)" }}>{provider === "gemini" ? "Gemini API 키 모양이 아닙니다 — AI Studio에서 받은 키(AIza… 또는 AQ.…)를 빈칸 없이 붙여 넣으세요" : `${info.label} API 키는 sk-ant-로 시작합니다`}</span>}

        <label className="field"><span>모델</span>
          <select value={modelValue} aria-label="모델" onChange={(e) => {
            const v = e.target.value;
            if (v === OTHER) { setCustom(chosen ?? ""); return; }
            setMyAiModel(provider, v || null);
            refresh(v ? `${v}를 씁니다` : "기본 모델을 씁니다");
          }}>
            <option value="">기본{ps ? ` (${ps.model})` : ""}</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
            <option value={OTHER}>다른 모델 이름 적기…</option>
          </select>
        </label>
        {(modelValue === OTHER || custom !== "") && (
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (AI_MODEL_RE[provider].test(custom.trim())) { setMyAiModel(provider, custom.trim()); setCustom(""); refresh(`${custom.trim()}를 씁니다`); } }}>
            <input className="mono grow" placeholder={provider === "gemini" ? "gemini-…" : "claude-…"} value={custom || (modelValue === OTHER ? chosen ?? "" : "")} aria-label="모델 이름" onChange={(e) => setCustom(e.target.value)} />
            <button disabled={!AI_MODEL_RE[provider].test(custom.trim())}>쓰기</button>
          </form>
        )}
        {note && <span className="small ok-text">{note}</span>}
        <span className="small muted">키는 {info.console}에서 만듭니다. 이 PC를 여러 사람이 쓰면 다 쓴 뒤 지우세요.{provider === "gemini" ? " Gemini는 모델 이름이 자주 바뀝니다 — 목록에 없으면 «다른 모델 이름 적기»로 적으세요." : ""}</span>
      </div>
    </div>
  );
}
