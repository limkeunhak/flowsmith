/**
 * 팀(관리자) — 만들기 · 이름 · 사람 넣고 빼기 · 지우기(플로우가 남았으면 못 지운다) · 팀 공용 값(SharedValues.tsx).
 * 관리자가 아니면 내 팀의 플로우와 공용(팀 없음) 플로우만 보인다.
 */
import { useEffect, useState } from "react";
import { api, ApiError, type TeamRow } from "../api.ts";
import { IconFolder, IconPlus, IconTrash, IconX } from "../icons.tsx";
import { EmptyState } from "../EmptyState.tsx";
import { ROLE_LABEL, useMe, type User } from "./me.ts";
import { SharedValues } from "./SharedValues.tsx";

export function Teams() {
  const me = useMe();
  const [teams, setTeams] = useState<TeamRow[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const load = async () => { try { const [t, u] = await Promise.all([api.listTeams(), api.listUsers()]); setTeams(t); setUsers(u); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { void load(); }, []);
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); } };
  const userById = new Map(users.map((u) => [u.id, u]));

  if (!me.can("admin")) return <div className="page"><div className="banner bad">관리자만 볼 수 있습니다</div></div>;
  return (
    <div className="page">
      <div className="page-head"><h1 className="grow">팀</h1></div>
      <div className="page-sub">팀원은 자기 팀과 공용 워크플로우만 볼 수 있습니다.</div>
      {error && <div className="banner bad" style={{ marginBottom: 12 }}>{error}</div>}
      <form className="row" style={{ marginBottom: 16, maxWidth: 480 }} onSubmit={(e) => { e.preventDefault(); void act(async () => { await api.addTeam(name); setName(""); }); }}>
        <input placeholder="새 팀 이름 — 예: 주문팀" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary" disabled={!name.trim()}><IconPlus size={15} /> 팀 만들기</button>
      </form>
      {teams === null ? <div className="empty">불러오는 중…</div> : teams.length === 0 ? <EmptyState icon={<IconFolder size={22} />} title="팀이 없습니다">팀이 없으면 모든 워크플로우가 공용입니다.</EmptyState> : (
        <div className="team-grid">
          {teams.map((t) => {
            const outside = users.filter((u) => !t.members.includes(u.id) && u.role !== "admin" && !u.disabled);
            return (
              <div key={t.id} className="card team-card">
                <div className="row">
                  <input className="title-input grow" defaultValue={t.name} aria-label="팀 이름" onBlur={(e) => { if (e.target.value.trim() && e.target.value !== t.name) void act(() => api.renameTeam(t.id, e.target.value)); }} />
                  <span className="pill">워크플로우 {t.flows}</span>
                  <button className="icon-btn" title={t.flows ? "워크플로우를 옮긴 뒤에 지울 수 있습니다" : "팀 지우기"} disabled={t.flows > 0}
                    onClick={() => { if (confirm(`«${t.name}» 팀을 지울까요?`)) void act(() => api.deleteTeam(t.id)); }}><IconTrash /></button>
                </div>
                <div className="team-members">
                  {t.members.length === 0 && <span className="small muted">아직 사람이 없습니다</span>}
                  {t.members.map((id) => { const u = userById.get(id); return (
                    <span key={id} className="member-chip" title={u?.email}>
                      <span className="avatar small">{(u?.name || u?.email || "?").slice(0, 1).toUpperCase()}</span>
                      {u?.name ?? id}<span className="muted small">{u ? ROLE_LABEL[u.role] : ""}</span>
                      <button className="icon-btn" title="팀에서 빼기" onClick={() => void act(() => api.removeMember(t.id, id))}><IconX size={12} /></button>
                    </span>
                  ); })}
                </div>
                {outside.length > 0 && (
                  <select value="" aria-label="팀에 사람 넣기" onChange={(e) => { if (e.target.value) void act(() => api.addMember(t.id, e.target.value)); }}>
                    <option value="">＋ 사람 넣기</option>
                    {outside.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.email} · {ROLE_LABEL[u.role]}</option>)}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}
      <SharedValues />
    </div>
  );
}
