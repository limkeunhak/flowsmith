/**
 * **테스트** — Suite 목록(웹 e2e 테스트 묶음, PLAN §39). 팀마다 여러 개 · 마지막 실행 · 만들기.
 * 한 Suite를 열면 시나리오 · 일정 · 알림 · 실행 기록(tests/SuitePage.tsx).
 */
import { useEffect, useState } from "react";
import { api, ApiError, type SuiteSummary } from "../api.ts";
import { useMe } from "../shell/me.ts";
import { IconPlus } from "../icons.tsx";
import { ago } from "../format.ts";
import { SuiteStatus } from "./SuitePage.tsx";

export function Suites() {
  const me = useMe();
  const [list, setList] = useState<SuiteSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [team, setTeam] = useState<string>(me.teams[0]?.id ?? "");
  const load = () => api.listSuites().then(setList, (e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const create = async () => {
    setError(null);
    try { const s = await api.createSuite(name, team || null); location.hash = `#/tests/${encodeURIComponent(s.id)}`; }
    catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
  };

  return (
    <div className="page tests">
      <div className="page-head"><h1 className="grow">테스트</h1></div>
      <div className="page-sub">Suite마다 시나리오(게시된 워크플로우)를 차례로 돌려 <b>통과 · 불통과 · 오류</b>를 봅니다. 검사 노드가 값을 판정하고, 불통과면 그때의 화면을 한 장 남깁니다.</div>
      {error && <div className="banner bad" style={{ marginBottom: 12 }}>{error}</div>}
      {me.can("editor") && (
        <form className="row" style={{ marginBottom: 16, maxWidth: 640 }} onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <input placeholder="새 Suite 이름 — 예: 주문 조회 회귀" value={name} aria-label="Suite 이름" onChange={(e) => setName(e.target.value)} />
          {me.auth && (
            <select value={team} aria-label="팀" style={{ width: "auto" }} onChange={(e) => setTeam(e.target.value)}>
              {me.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              <option value="">공용</option>
            </select>
          )}
          <button className="primary" disabled={!name.trim()}><IconPlus size={15} /> Suite 만들기</button>
        </form>
      )}
      {list === null ? <div className="empty">불러오는 중…</div> : list.length === 0 ? (
        <div className="card empty-state"><b>아직 Suite가 없습니다</b><span>검사 노드로 기대값을 정한 워크플로우를 게시한 뒤, Suite를 만들어 시나리오로 넣으세요.</span></div>
      ) : (
        <div className="suite-list">
          {list.map((s) => (
            <a key={s.id} className="card suite-row" href={`#/tests/${encodeURIComponent(s.id)}`}>
              <div className="grow">
                <b>{s.name}</b>
                <div className="small muted">
                  {s.team ? s.team.name : "공용"} · 시나리오 {s.items.filter((i) => i.enabled).length}개
                  {s.schedules.some((x) => x.enabled) ? ` · 일정 ${s.schedules.filter((x) => x.enabled).map((x) => x.cron).join(", ")}` : ""}
                </div>
              </div>
              {s.running ? <span className="pill accent">도는 중</span> : s.lastRun ? <span className="row small" style={{ gap: 8 }}><SuiteStatus run={s.lastRun} /><span className="muted">{ago(s.lastRun.startedAt)}</span></span> : <span className="small muted">아직 안 돌림</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
