/**
 * 워커(젠킨스의 «노드 관리») — 실행을 받아 가는 PC들. 맨 위는 서버(내장), 그 아래 워커마다
 * 연결 · 라벨 · 동시 실행 수 · 지금 도는 실행 · 기다리는 수 · 그 PC(이름 · 확장).
 * 관리자: 더하기(토큰과 켤 명령은 이때 한 번) · 이름 · 라벨 · 동시 실행 수 · 잠시 끄기 · 새 토큰 · 지우기.
 * ★워커를 하나도 붙이지 않으면 서버 혼자 돈다(standalone) — 이 화면은 비어 있어도 된다.
 */
import { useState } from "react";
import { api, ApiError, type WorkerRow } from "../api.ts";
import { IconCopy, IconKey, IconMonitor, IconPlus, IconTrash, IconX } from "../icons.tsx";
import { useMe } from "./me.ts";
import { useWorkers } from "./workers.ts";
import { ago } from "../format.ts";


export function Workers() {
  const me = useMe();
  const admin = me.can("admin");
  const [tick, setTick] = useState(0);
  const v = useWorkers(true, 3000, tick);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); setTick((t) => t + 1); } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); } };

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="grow">워커</h1>
        {admin && <button className="primary" onClick={() => { setAdding(true); setIssued(null); }}><IconPlus size={15} /> 워커 더하기</button>}
      </div>
      <div className="page-sub">워크플로우를 실행할 PC를 연결하고 관리합니다.</div>
      {error && <div className="banner bad" style={{ marginBottom: 12 }}>{error}</div>}
      {issued && <TokenBanner {...issued} onClose={() => setIssued(null)} />}
      {adding && admin && <AddWorker onCancel={() => setAdding(false)} onDone={(name, token) => { setAdding(false); setIssued({ name, token }); setTick((t) => t + 1); }} />}
      {v === null ? <div className="empty">불러오는 중…</div> : (
        <div className="worker-list">
          <div className="card worker-card">
            <div className="row">
              <span className="worker-dot on" />
              <IconMonitor size={16} /><span className="worker-name grow">서버 <span className="pill">기본</span></span>
              {v.server.waiting > 0 && <span className="pill warn">대기 {v.server.waiting}</span>}
              <span className="pill" title="동시 실행">실행 {v.server.active}/{v.server.max}</span>
            </div>
          </div>
          {v.workers.length === 0 && (
            <div className="card empty-state">
              <b>연결된 워커가 없습니다</b>
              <span>사람 PC의 크롬으로 실행하거나 녹화해야 할 때 워커를 추가하세요.</span>
              {admin && <button className="primary" onClick={() => { setAdding(true); setIssued(null); }}><IconPlus size={15} /> 워커 더하기</button>}
            </div>
          )}
          {v.workers.map((w) => <WorkerCard key={w.id} w={w} admin={admin} act={act} onToken={(token) => setIssued({ name: w.name, token })} />)}
        </div>
      )}
    </div>
  );
}

function WorkerCard({ w, admin, act, onToken }: { w: WorkerRow; admin: boolean; act: (fn: () => Promise<unknown>) => Promise<void>; onToken: (t: string) => void }) {
  const state = !w.enabled ? { cls: "off", text: `잠시 끔 · 녹화만 받음${w.online ? " · 연결됨" : ""}` } : w.online ? { cls: "on", text: `연결됨 · ${ago(w.connectedAt)}부터` } : { cls: "down", text: `꺼짐 · 마지막 연결 ${ago(w.lastSeenAt, "없음")}` };
  return (
    <div className={`card worker-card${w.online ? "" : " offline"}`}>
      <div className="row">
        <span className={`worker-dot ${state.cls}`} title={state.text} />
        {admin ? <input className="title-input grow" defaultValue={w.name} aria-label="워커 이름" onBlur={(e) => { if (e.target.value.trim() && e.target.value !== w.name) void act(() => api.updateWorker(w.id, { name: e.target.value })); }} />
          : <b className="grow">{w.name}</b>}
        {w.team && <span className="team-pill">{w.team.name} 전용</span>}
        {(w.recording ?? 0) > 0 && <span className="pill accent">녹화 중</span>}
        {w.queued > 0 && <span className="pill warn">대기 {w.queued}</span>}
        <span className="pill" title="동시 실행">실행 {w.running.length}/{w.slots}</span>
        <span className="pill" title="이 워커에서 실행하는 워크플로우">워크플로우 {w.flows}</span>
      </div>
      <div className="worker-meta">{state.text}{w.info ? ` · ${w.info.host}` : ""}{w.info?.capabilities?.includes("wallet") ? " · 🦊 지갑 브라우저(MetaMask) 됨" : ""}{w.info?.extensions.length ? ` · 확장 ${w.info.extensions.join(", ")}` : ""}{w.info?.plugins && Object.keys(w.info.plugins).length ? ` · 플러그인 ${Object.entries(w.info.plugins).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}</div>
      {w.info?.pluginErrors && Object.keys(w.info.pluginErrors).length > 0 && <div className="banner bad small">플러그인을 싣지 못했습니다 — {Object.entries(w.info.pluginErrors).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>}
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="small muted">라벨</span>
        {admin ? <input className="mono grow" style={{ maxWidth: 360 }} placeholder="라벨 없음" defaultValue={w.labels.join(", ")} aria-label="라벨"
          onBlur={(e) => { if (e.target.value !== w.labels.join(", ")) void act(() => api.updateWorker(w.id, { labels: e.target.value })); }} />
          : w.labels.length ? w.labels.map((l) => <span key={l} className="pill accent">{l}</span>) : <span className="small muted">없음</span>}
        {admin && (
          <label className="small muted row" style={{ gap: 6 }}>동시 실행
            <select value={w.slots} aria-label="동시 실행 수" onChange={(e) => void act(() => api.updateWorker(w.id, { slots: Number(e.target.value) }))}>
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </div>
      {w.running.length > 0 && (
        <div className="worker-running">
          {w.running.map((r) => <a key={r.runId} href={`#/flows/${encodeURIComponent(r.flowId)}/runs/${encodeURIComponent(r.runId)}`}><span className="spinner" /> {r.flowName}</a>)}
        </div>
      )}
      {admin && (
        <div className="row" style={{ gap: 6 }}>
          <button className="small" onClick={() => void act(() => api.updateWorker(w.id, { enabled: !w.enabled }))}>{w.enabled ? "잠시 끄기" : "다시 켜기"}</button>
          <button className="small" onClick={() => { if (confirm(`«${w.name}»의 토큰을 새로 만들까요? 지금 연결은 끊기고, 그 PC는 새 토큰으로 다시 켜야 합니다.`)) void act(async () => onToken((await api.renewWorkerToken(w.id)).token)); }}><IconKey size={13} /> 새 토큰</button>
          <span className="grow" />
          <button className="icon-btn" disabled={w.flows > 0} title={w.flows > 0 ? "이 워커에서 실행하는 워크플로우가 있어 지울 수 없습니다" : "워커 지우기"}
            onClick={() => { if (confirm(`«${w.name}» 워커를 지울까요?`)) void act(() => api.deleteWorker(w.id)); }}><IconTrash /></button>
        </div>
      )}
    </div>
  );
}

function AddWorker({ onCancel, onDone }: { onCancel: () => void; onDone: (name: string, token: string) => void }) {
  const me = useMe();
  const [name, setName] = useState("");
  const [labels, setLabels] = useState("");
  const [slots, setSlots] = useState(1);
  const [team, setTeam] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="card stack" style={{ padding: 14, marginBottom: 12, maxWidth: 560 }} onSubmit={(e) => {
      e.preventDefault();
      setError(null);
      void api.addWorker({ name, labels, slots, team: team || null }).then((r) => onDone(r.worker.name, r.token), (e: Error) => setError(e.message));
    }}>
      <div className="row"><h2 className="grow">워커 더하기</h2><button type="button" className="icon-btn" onClick={onCancel}><IconX /></button></div>
      <label className="field"><span>이름</span><input autoFocus placeholder="예: 김담당 PC" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field"><span>라벨 <em className="hint">쉼표로 구분</em></span><input className="mono" placeholder="관리자화면, 크롬로그인" value={labels} onChange={(e) => setLabels(e.target.value)} /></label>
      <div className="row">
        <label className="field grow"><span>동시 실행</span>
          <select value={slots} onChange={(e) => setSlots(Number(e.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
        {me.auth && (
          <label className="field grow"><span>팀</span>
            <select value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">모든 팀</option>
              {me.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {error && <div className="banner bad small">{error}</div>}
      <div className="row"><span className="grow" /><button type="button" onClick={onCancel}>그만두기</button><button className="primary" disabled={!name.trim()}>만들고 토큰 받기</button></div>
    </form>
  );
}

/** 토큰은 이때 한 번만 — 그 PC에서 켤 명령까지 */
function TokenBanner({ name, token, onClose }: { name: string; token: string; onClose: () => void }) {
  const server = location.origin;
  const sh = `FLOWSMITH_WORKER_TOKEN=${token} node packages/worker/src/main.ts --server ${server}`;
  const ps = `$env:FLOWSMITH_WORKER_TOKEN="${token}"; node packages/worker/src/main.ts --server ${server}`;
  const copy = (t: string) => { void navigator.clipboard?.writeText(t).catch(() => undefined); };
  return (
    <div className="banner warn token-banner" style={{ marginBottom: 12 }}>
      <div className="row"><b className="grow">«{name}» 토큰 — 지금 한 번만 표시됩니다</b><button className="icon-btn" onClick={onClose}><IconX /></button></div>
      <code className="token">{token}</code>
      <div className="small">워커 PC의 Flowsmith 폴더에서 실행하세요.</div>
      {server.startsWith("http:") && !/\/\/(127\.0\.0\.1|localhost)/.test(server) && <div className="small"><b>https 주소가 아니라 워커가 연결되지 않습니다.</b> 서버에 https를 설정하세요.</div>}
      <div className="row"><code className="cmd grow">{ps}</code><button className="small" type="button" onClick={() => copy(ps)}><IconCopy size={13} /> Windows</button></div>
      <div className="row"><code className="cmd grow">{sh}</code><button className="small" type="button" onClick={() => copy(sh)}><IconCopy size={13} /> macOS · Linux</button></div>
      <div className="small muted">크롬에 붙는 워크플로우는 크롬을 <code>--remote-debugging-port=9222</code>로 띄워 두세요.</div>
    </div>
  );
}
