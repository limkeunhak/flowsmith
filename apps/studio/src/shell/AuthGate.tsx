/**
 * 들어가는 문 — 로그인을 켠 서버면 로그인부터. 사람이 하나도 없으면 첫 관리자 만들기(설정 토큰).
 * 관리자가 정해 준 임시 비밀번호로 들어왔으면 먼저 바꾼다.
 * ☆로그인 서버를 이으면 이 화면에 «회사 계정으로 로그인» 단추가 붙는다(지금 것은 임시 — 메일 + 비밀번호).
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "../api.ts";
import { IconRocket } from "../icons.tsx";
import { MeContext, meOf, type Me, type Team, type User } from "./me.ts";

type State = { kind: "loading" } | { kind: "off" } | { kind: "login" } | { kind: "setup" } | { kind: "change"; user: User } | { kind: "in"; user: User; teams: Team[] } | { kind: "down"; error: string };

function Door({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="door">
      <div className="door-card card">
        <div className="door-brand"><span className="side-mark"><IconRocket size={18} /></span><b>Flowsmith</b></div>
        <h1>{title}</h1>
        <p className="muted small">{sub}</p>
        {children}
      </div>
    </div>
  );
}

function useForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    setBusy(false);
  };
  return { error, busy, run };
}

function Login({ onIn }: { onIn: (u: User) => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const f = useForm();
  return (
    <Door title="로그인" sub="회사에서 받은 계정으로 들어갑니다">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void f.run(async () => onIn((await api.login(email, pw)).user)); }}>
        <label className="field"><span>메일</span><input type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field"><span>비밀번호</span><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {f.error && <div className="banner bad small">{f.error}</div>}
        <button className="primary" disabled={f.busy || !email || !pw}>로그인</button>
        <span className="small muted">계정이 없거나 비밀번호를 잊었으면 관리자에게 물어보세요.</span>
      </form>
    </Door>
  );
}

function Setup({ onIn }: { onIn: (u: User) => void }) {
  const [v, setV] = useState({ token: "", email: "", name: "", password: "", again: "" });
  const f = useForm();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const mismatch = v.again !== "" && v.again !== v.password;
  return (
    <Door title="첫 관리자 만들기" sub="이 서버에는 아직 사람이 없습니다. 서버를 띄운 콘솔에 찍힌 «설정 토큰»을 넣고 관리자 계정을 만드세요.">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void f.run(async () => onIn((await api.setup({ token: v.token.trim(), email: v.email, name: v.name, password: v.password })).user)); }}>
        <label className="field"><span>설정 토큰</span><input className="mono" autoFocus value={v.token} onChange={set("token")} /></label>
        <label className="field"><span>이름</span><input value={v.name} onChange={set("name")} placeholder="김관리" /></label>
        <label className="field"><span>메일</span><input type="email" autoComplete="username" value={v.email} onChange={set("email")} /></label>
        <label className="field"><span>비밀번호(8자 이상)</span><input type="password" autoComplete="new-password" value={v.password} onChange={set("password")} /></label>
        <label className="field"><span>한 번 더</span><input type="password" autoComplete="new-password" value={v.again} onChange={set("again")} /></label>
        {mismatch && <span className="small" style={{ color: "var(--bad)" }}>두 비밀번호가 다릅니다</span>}
        {f.error && <div className="banner bad small">{f.error}</div>}
        <button className="primary" disabled={f.busy || !v.token || !v.email || !v.password || mismatch || v.again === ""}>만들고 들어가기</button>
      </form>
    </Door>
  );
}

export function ChangePassword({ forced, onDone, onCancel }: { forced: boolean; onDone: () => void; onCancel?: () => void }) {
  const [v, setV] = useState({ current: "", next: "", again: "" });
  const f = useForm();
  const mismatch = v.again !== "" && v.again !== v.next;
  const body = (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void f.run(async () => { await api.changePassword(v.current, v.next); onDone(); }); }}>
      <label className="field"><span>{forced ? "받은 임시 비밀번호" : "지금 비밀번호"}</span><input type="password" autoComplete="current-password" autoFocus value={v.current} onChange={(e) => setV({ ...v, current: e.target.value })} /></label>
      <label className="field"><span>새 비밀번호(8자 이상)</span><input type="password" autoComplete="new-password" value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} /></label>
      <label className="field"><span>한 번 더</span><input type="password" autoComplete="new-password" value={v.again} onChange={(e) => setV({ ...v, again: e.target.value })} /></label>
      {mismatch && <span className="small" style={{ color: "var(--bad)" }}>두 비밀번호가 다릅니다</span>}
      {f.error && <div className="banner bad small">{f.error}</div>}
      <div className="row"><span className="grow" />{onCancel && <button type="button" onClick={onCancel}>그만두기</button>}<button className="primary" disabled={f.busy || !v.current || !v.next || mismatch || v.again === ""}>바꾸기</button></div>
    </form>
  );
  return forced ? <Door title="비밀번호 바꾸기" sub="관리자가 정해 준 임시 비밀번호로 들어왔습니다. 나만 아는 비밀번호로 바꿔 주세요.">{body}</Door> : body;
}

export function AuthGate({ children }: { children: (me: Me, logout: () => void) => ReactNode }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const load = useCallback(() => {
    void api.me().then((m) => {
      if (m.auth === "off") setState({ kind: "off" });
      else if (m.user) setState(m.user.mustChange ? { kind: "change", user: m.user } : { kind: "in", user: m.user, teams: m.teams ?? [] });
      else setState({ kind: m.setup ? "setup" : "login" });
    }, (e: Error) => setState({ kind: "down", error: e.message }));
  }, []);
  useEffect(() => { load(); }, [load]);
  // 일하다가 로그인이 끊기면(만료 · 관리자가 끔) 로그인 화면으로
  useEffect(() => {
    const on = () => setState((s) => (s.kind === "in" || s.kind === "change" ? { kind: "login" } : s));
    addEventListener("flowsmith:login-required", on);
    return () => removeEventListener("flowsmith:login-required", on);
  }, []);
  // 들어온 뒤에는 내 팀까지 다시 받는다
  const signedIn = (u: User) => { if (u.mustChange) setState({ kind: "change", user: u }); else load(); };
  // 로그아웃하면 첫 화면으로 — 다음 사람이 앞 사람이 보던 화면(사람 · 편집)에서 시작하지 않게
  const logout = () => { void api.logout().finally(() => { location.hash = "#/"; setState({ kind: "login" }); }); };

  switch (state.kind) {
    case "loading": return <div className="door"><span className="muted">불러오는 중…</span></div>;
    case "down": return <div className="door"><div className="banner bad">서버에 닿지 못했습니다 — {state.error}</div></div>;
    case "login": return <Login onIn={signedIn} />;
    case "setup": return <Setup onIn={signedIn} />;
    case "change": return <ChangePassword forced onDone={load} />;
    case "off": return <MeContext.Provider value={meOf(false, null)}>{children(meOf(false, null), () => undefined)}</MeContext.Provider>;
    case "in": { const me = meOf(true, state.user, state.teams); return <MeContext.Provider value={me}>{children(me, logout)}</MeContext.Provider>; }
  }
}
