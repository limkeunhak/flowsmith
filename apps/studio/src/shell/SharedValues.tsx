/**
 * **팀 공용 값**(관리자 · 팀 화면 아래) — 여러 플로우가 함께 쓰는 변수 · 시크릿. 플로우는 제 팀 → 공용 차례로 찾는다.
 *   변수   값이 보인다(주소 · 코드 같은 것)
 *   시크릿 값은 넣기만 — 다시 보이지 않는다(잠겨 저장). 플로우의 시크릿 정의에서 «팀 공용 값 쓰기»를 켜면 이것을 쓴다
 */
import { useEffect, useState } from "react";
import { api, ApiError, type SharedValue } from "../api.ts";
import { IconPlus, IconTrash } from "../icons.tsx";

type Kind = "var" | "text" | "login";
const KIND_LABEL: Record<Kind, string> = { var: "변수", text: "시크릿 · 글자 하나", login: "시크릿 · 로그인" };

export function SharedValues() {
  const [data, setData] = useState<{ teams: { id: string; name: string }[]; values: SharedValue[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.listShared().then(setData, (e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); } };

  if (!data) return <div className="empty">불러오는 중…</div>;
  const scopes = [{ id: "", name: "공용 — 모든 팀" }, ...data.teams];
  return (
    <section className="shared-values stack">
      <div className="page-head"><h2 className="grow">팀 공용 값</h2></div>
      <div className="page-sub">
        여러 워크플로우가 함께 쓰는 변수 · 시크릿입니다. 워크플로우는 <b>제 팀 → 공용</b> 차례로 찾습니다(같은 이름이면 팀 것). 워크플로우 설정에서 «팀 공용 변수»를 고르거나
        시크릿의 «팀 공용 값 쓰기»를 켜면 씁니다 — 계정이 바뀌면 여기 한 곳만 고치면 됩니다.
      </div>
      {error && <div className="banner bad">{error}</div>}
      <div className="team-grid">
        {scopes.map((s) => (
          <ScopeCard key={s.id || "_"} scope={s.id} title={s.name} values={data.values.filter((v) => v.scope === s.id)} act={act} />
        ))}
      </div>
    </section>
  );
}

function ScopeCard({ scope, title, values, act }: { scope: string; title: string; values: SharedValue[]; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [kind, setKind] = useState<Kind>("var");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [v, setV] = useState<Record<string, string>>({});
  const reset = () => { setName(""); setDesc(""); setV({}); };
  const add = () => act(async () => {
    if (kind === "var") await api.putSharedVar(scope, name, v["value"] ?? "", desc);
    else await api.putSharedSecret(scope, name, kind, kind === "text" ? v["value"] ?? "" : { username: v["username"] ?? "", password: v["password"] ?? "", ...(v["extra"] ? { extra: v["extra"] } : {}) }, desc);
    reset();
  });
  return (
    <div className="card shared-card stack" aria-label={`팀 공용 값 — ${title}`}>
      <b>{title}</b>
      {values.length === 0 && <span className="small muted">아직 없습니다</span>}
      {values.map((x) => (
        <div key={`${x.kind}/${x.name}`} className="row small shared-row">
          <span className={`pill ${x.kind === "secret" ? "warn" : ""}`}>{x.kind === "var" ? "변수" : x.secretKind === "login" ? "🔒 로그인" : "🔒 글자"}</span>
          <span className="mono">{x.name}</span>
          <span className="grow muted shared-value" title={x.description}>{x.kind === "var" ? x.value : "잠겨 있음"}{x.description ? ` — ${x.description}` : ""}</span>
          <button className="icon-btn" title="지우기 — 쓰는 워크플로우는 «값 없음»으로 시작하지 못합니다" onClick={() => { if (confirm(`«${x.name}»을(를) 지울까요? 이 값을 쓰는 워크플로우는 시작하지 못합니다.`)) void act(() => api.deleteShared(scope, x.kind, x.name)); }}><IconTrash size={14} /></button>
        </div>
      ))}
      <form className="stack shared-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <div className="row">
          <select value={kind} aria-label="종류" style={{ width: "auto", flex: "none" }} onChange={(e) => { setKind(e.target.value as Kind); setV({}); }}>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <input className="mono grow" placeholder="이름 — 예: portal_url" value={name} aria-label="이름" onChange={(e) => setName(e.target.value)} />
        </div>
        {kind === "var" && <input className="mono" placeholder="값" value={v["value"] ?? ""} aria-label="값" onChange={(e) => setV({ value: e.target.value })} />}
        {kind === "text" && <input type="password" autoComplete="new-password" placeholder="값(다시 보이지 않습니다)" value={v["value"] ?? ""} aria-label="값" onChange={(e) => setV({ value: e.target.value })} />}
        {kind === "login" && (
          <div className="row wrap">
            <input autoComplete="off" placeholder="아이디" value={v["username"] ?? ""} aria-label="아이디" onChange={(e) => setV((x) => ({ ...x, username: e.target.value }))} />
            <input type="password" autoComplete="new-password" placeholder="비밀번호" value={v["password"] ?? ""} aria-label="비밀번호" onChange={(e) => setV((x) => ({ ...x, password: e.target.value }))} />
            <input autoComplete="off" placeholder="추가 칸(있으면)" value={v["extra"] ?? ""} aria-label="추가 칸" onChange={(e) => setV((x) => ({ ...x, extra: e.target.value }))} />
          </div>
        )}
        <div className="row">
          <input className="grow" placeholder="설명(없어도 됩니다)" value={desc} aria-label="설명" onChange={(e) => setDesc(e.target.value)} />
          <button className="small primary" disabled={!name.trim()}><IconPlus size={14} /> 넣기</button>
        </div>
        <span className="small muted">같은 이름이 있으면 바꿉니다.</span>
      </form>
    </div>
  );
}
