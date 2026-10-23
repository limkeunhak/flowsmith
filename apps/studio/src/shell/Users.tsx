/**
 * 사람(관리자) — 들이기 · 역할 · 끄기 · 임시 비밀번호. 임시 비밀번호는 만들 때 한 번만 보인다(서버에는 해시만).
 * ☆로그인 서버를 이으면 사람은 처음 로그인할 때 저절로 생긴다(«보는 사람») — 여기서는 역할만 준다.
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "../api.ts";
import { IconCopy, IconPlus, IconX } from "../icons.tsx";
import { ROLE_LABEL, useMe, type Role, type User } from "./me.ts";
import { dateTime } from "../format.ts";

const ROLES: Role[] = ["admin", "editor", "runner", "viewer"];
const ROLE_HINT: Record<Role, string> = {
  admin: "사람을 들이고 역할을 줍니다 · 무엇이든",
  editor: "워크플로우를 만들고 고치고 녹화 · 게시합니다",
  runner: "게시된 워크플로우를 돌리고 멈추고 기록을 봅니다",
  viewer: "보기만 합니다",
};

export function Users() {
  const me = useMe();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ email: string; name: string; role: Role }>({ email: "", name: "", role: "viewer" });
  const [shown, setShown] = useState<{ email: string; pw: string } | null>(null);
  const load = () => api.listUsers().then(setUsers, (e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); } };

  if (!me.can("admin")) return <div className="page"><div className="banner bad">관리자만 볼 수 있습니다</div></div>;
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="grow">사람</h1>
        <button className="primary" onClick={() => setAdding(!adding)}><IconPlus size={15} /> 사람 들이기</button>
      </div>
      <div className="page-sub">사람을 초대하고 역할을 정합니다.</div>
      {error && <div className="banner bad" style={{ marginBottom: 12 }}>{error}</div>}
      {shown && (
        <div className="banner warn stack" style={{ marginBottom: 12, gap: 6 }}>
          <b>{shown.email} 임시 비밀번호 — 지금 한 번만 표시됩니다</b>
          <div className="row"><code className="token grow">{shown.pw}</code><button className="icon-btn" title="복사" onClick={() => void navigator.clipboard?.writeText(shown.pw)}><IconCopy /></button><button className="icon-btn" title="닫기" onClick={() => setShown(null)}><IconX /></button></div>
        </div>
      )}
      {adding && (
        <form className="card stack" style={{ padding: 16, marginBottom: 16 }} onSubmit={(e) => {
          e.preventDefault();
          void act(async () => { const r = await api.addUser(form); setShown({ email: r.user.email, pw: r.tempPassword }); setAdding(false); setForm({ email: "", name: "", role: "viewer" }); });
        }}>
          <div className="row wrap">
            <label className="field grow"><span>메일</span><input type="email" autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="field grow"><span>이름</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field"><span>역할</span><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
          </div>
          <div className="small muted">{ROLE_LABEL[form.role]} — {ROLE_HINT[form.role]}</div>
          <div className="row"><span className="small muted grow">임시 비밀번호가 만들어지고, 처음 로그인할 때 바꿉니다.</span><button type="button" onClick={() => setAdding(false)}>그만두기</button><button className="primary" disabled={!form.email}>들이기</button></div>
        </form>
      )}
      <div className="card">
        {users === null ? <div className="empty">불러오는 중…</div> : (
          <div className="flow-rows">
            {users.map((u) => (
              <div key={u.id} className={`flow-row user-row${u.disabled ? " off" : ""}`}>
                <span className="avatar">{(u.name || u.email).slice(0, 1).toUpperCase()}</span>
                <div className="grow">
                  <div className="name">{u.name}{u.id === me.user?.id && <span className="pill accent" style={{ marginLeft: 6 }}>나</span>}{u.disabled && <span className="pill" style={{ marginLeft: 6 }}>꺼 둠</span>}</div>
                  <div className="meta">{u.email} · 마지막 로그인 {dateTime(u.lastLoginAt)}{u.mustChange ? " · 임시 비밀번호" : ""}</div>
                </div>
                <select value={u.role} aria-label={`${u.email}의 역할`} onChange={(e) => void act(() => api.updateUser(u.id, { role: e.target.value as Role }))}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                <button className="small" onClick={() => { if (confirm(`${u.email}의 비밀번호를 새 임시 비밀번호로 바꿀까요? 그 사람의 로그인은 끊깁니다.`)) void act(async () => setShown({ email: u.email, pw: (await api.resetUser(u.id)).tempPassword })); }}>비밀번호 초기화</button>
                <button className={`small${u.disabled ? "" : " danger"}`} onClick={() => void act(() => api.updateUser(u.id, { disabled: !u.disabled }))}>{u.disabled ? "다시 켜기" : "끄기"}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
