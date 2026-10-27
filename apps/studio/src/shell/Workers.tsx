/**
 * 워커(젠킨스의 «노드 관리») — 실행을 받아 가는 PC들. 맨 위는 서버(내장), 그 아래 워커마다
 * 연결 · 라벨 · 동시 실행 수 · 지금 도는 실행 · 기다리는 수 · 그 PC(이름 · 확장).
 * 관리자: 더하기(토큰과 켤 명령은 이때 한 번) · 이름 · 라벨 · 동시 실행 수 · 잠시 끄기 · 새 토큰 · 지우기.
 * 워커 두 종류(PLAN §44 · 4단계): **공용 워커** — 누구의 실행이든 · 일정 · 웹훅(도커 · 서버실 PC) ·
 *  **개인 워커** — 주인이 «내 PC에서 실행하기»로 돌린 실행만(그 사람의 데스크톱 앱). 개인 워커는 관리자와 그 주인만 본다.
 * ★워커를 하나도 붙이지 않으면 서버 혼자 돈다(standalone) — 이 화면은 비어 있어도 된다.
 */
import { useEffect, useState } from "react";
import { api, ApiError, type WorkerRow } from "../api.ts";
import { IconCopy, IconKey, IconMonitor, IconPlus, IconTrash, IconX } from "../icons.tsx";
import { EmptyState } from "../EmptyState.tsx";
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
  const [issued, setIssued] = useState<{ name: string; token: string; personal: boolean } | null>(null);
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
      {adding && admin && <AddWorker onCancel={() => setAdding(false)} onDone={(name, token, personal) => { setAdding(false); setIssued({ name, token, personal }); setTick((t) => t + 1); }} />}
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
            // 「워커 더하기」는 제목 줄에 있다 — 여기에 또 두지 않는다
            <EmptyState icon={<IconMonitor size={22} />} title="연결된 워커가 없습니다">
              공용 워커(도커 · 서버실 PC)는 누구의 실행이든 받고, 개인 워커는 그 사람이 «내 PC에서 실행하기»로 돌린 실행만 받습니다(데스크톱 앱).
            </EmptyState>
          )}
          {v.workers.map((w) => <WorkerCard key={w.id} w={w} admin={admin} act={act} onToken={(token) => setIssued({ name: w.name, token, personal: w.kind === "personal" })} />)}
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
        {w.kind === "personal" ? <span className="pill accent" title="주인이 «내 PC에서 실행하기»로 돌린 실행만 받습니다">개인 · {w.owner}</span> : <span className="pill" title="누구의 실행이든 · 일정 · 웹훅을 받습니다">공용</span>}
        {w.team && <span className="team-pill">{w.team.name} 전용</span>}
        {(w.recording ?? 0) > 0 && <span className="pill accent">녹화 중</span>}
        {w.queued > 0 && <span className="pill warn">대기 {w.queued}</span>}
        <span className="pill" title="동시 실행">실행 {w.running.length}/{w.slots}</span>
        {w.kind === "shared" && <span className="pill" title="이 워커에서 실행하는 워크플로우">워크플로우 {w.flows}</span>}
      </div>
      <div className="worker-meta">{state.text}{w.info ? ` · ${w.info.host}` : ""}{w.info?.capabilities?.includes("wallet") ? " · 🦊 지갑 브라우저(MetaMask) 됨" : ""}{w.info?.capabilities?.includes("app") ? " · 🖥 앱 안 브라우저 됨" : ""}{w.info?.extensions.length ? ` · 확장 ${w.info.extensions.join(", ")}` : ""}{w.info?.plugins && Object.keys(w.info.plugins).length ? ` · 플러그인 ${Object.entries(w.info.plugins).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}</div>
      {w.info?.pluginErrors && Object.keys(w.info.pluginErrors).length > 0 && <div className="banner bad small">플러그인을 싣지 못했습니다 — {Object.entries(w.info.pluginErrors).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>}
      <div className="row wrap" style={{ gap: 6 }}>
        {w.kind === "shared" && <span className="small muted">라벨</span>}
        {w.kind === "personal" ? <span className="small muted grow">라벨 · «어디서 돌리나»로는 고르지 않습니다 — 주인이 실행할 때 «내 PC에서 실행하기»로만</span> : admin ? <input className="mono grow" style={{ maxWidth: 360 }} placeholder="라벨 없음" defaultValue={w.labels.join(", ")} aria-label="라벨"
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

function AddWorker({ onCancel, onDone }: { onCancel: () => void; onDone: (name: string, token: string, personal: boolean) => void }) {
  const me = useMe();
  const [kind, setKind] = useState<"shared" | "personal">("shared");
  const [owner, setOwner] = useState("");
  const [people, setPeople] = useState<{ email: string; name: string }[] | null>(null);
  useEffect(() => { if (kind === "personal" && people === null) void api.listUsers().then((u) => setPeople(u.map((x) => ({ email: x.email, name: x.name }))), () => setPeople([])); }, [kind, people]);
  const [name, setName] = useState("");
  const [labels, setLabels] = useState("");
  const [slots, setSlots] = useState(1);
  const [team, setTeam] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="card stack" style={{ padding: 14, marginBottom: 12, maxWidth: 560 }} onSubmit={(e) => {
      e.preventDefault();
      setError(null);
      const personal = kind === "personal";
      void api.addWorker({ name, labels: personal ? "" : labels, slots, team: personal ? null : team || null, kind, owner: personal ? owner : null }).then((r) => onDone(r.worker.name, r.token, personal), (e: Error) => setError(e.message));
    }}>
      <div className="row"><h2 className="grow">워커 더하기</h2><button type="button" className="icon-btn" onClick={onCancel}><IconX /></button></div>
      <div className="stack" style={{ gap: 6 }}>
        <label className="check"><input type="radio" checked={kind === "shared"} onChange={() => setKind("shared")} /><b>공용 워커</b> — 누구의 실행이든 · 일정 · 웹훅을 받습니다(도커 · 서버실 PC)</label>
        <label className="check"><input type="radio" checked={kind === "personal"} disabled={!me.auth} onChange={() => setKind("personal")} /><b>개인 워커</b> — 그 사람이 «내 PC에서 실행하기»로 돌린 실행만 받습니다(데스크톱 앱){!me.auth && " · 로그인을 켠 서버에서만"}</label>
      </div>
      <label className="field"><span>이름</span><input autoFocus placeholder={kind === "personal" ? "예: 김철수 PC" : "예: 도커 워커 1"} value={name} onChange={(e) => setName(e.target.value)} /></label>
      {kind === "personal" ? (
        <label className="field"><span>주인</span>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">고르세요</option>
            {(people ?? []).map((u) => <option key={u.email} value={u.email}>{u.name} · {u.email}</option>)}
          </select>
        </label>
      ) : (
        <label className="field"><span>라벨 <em className="hint">쉼표로 구분</em></span><input className="mono" placeholder="관리자화면, 크롬로그인" value={labels} onChange={(e) => setLabels(e.target.value)} /></label>
      )}
      <div className="row">
        <label className="field grow"><span>동시 실행</span>
          <select value={slots} onChange={(e) => setSlots(Number(e.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
        {me.auth && kind === "shared" && (
          <label className="field grow"><span>팀</span>
            <select value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">모든 팀</option>
              {me.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {error && <div className="banner bad small">{error}</div>}
      <div className="row"><span className="grow" /><button type="button" onClick={onCancel}>그만두기</button><button className="primary" disabled={!name.trim() || (kind === "personal" && !owner)}>만들고 토큰 받기</button></div>
    </form>
  );
}

/** 토큰은 이때 한 번만 — 그 PC에서 켤 명령까지 */
function TokenBanner({ name, token, personal, onClose }: { name: string; token: string; personal: boolean; onClose: () => void }) {
  const server = location.origin;
  const insecure = server.startsWith("http:") && !/\/\/(127\.0\.0\.1|localhost)/.test(server);
  // 개인 워커 — 그 사람의 데스크톱 앱에 넣는다(첫 화면 «회사 서버에 붙기» · 한 번만)
  if (personal) return (
    <div className="banner warn token-banner" style={{ marginBottom: 12 }}>
      <div className="row"><b className="grow">«{name}» 토큰 — 지금 한 번만 표시됩니다</b><button className="icon-btn" onClick={onClose}><IconX /></button></div>
      <div className="row"><code className="token grow">{token}</code><button className="small" type="button" onClick={() => { void navigator.clipboard?.writeText(token).catch(() => undefined); }}><IconCopy size={13} /> 복사</button></div>
      <div className="small">그 사람에게 전하세요 — Flowsmith 앱을 깔고 첫 화면에서 <b>회사 서버에 붙기</b>를 골라 서버 주소 <code>{server}</code>와 이 토큰을 넣습니다. 그 PC에 한 번만 넣으면 됩니다.</div>
      <div className="small">앱 없이 웹으로만 쓴다면 — 그 PC의 Flowsmith 폴더에서 워커 프로그램을 켭니다(<code>--headed</code>면 실행할 때 그 PC에 브라우저 창이 떠 눈으로 봅니다 · 지갑 브라우저도 됩니다). 그러면 웹 편집 화면의 실행 단추에 <b>내 PC에서 실행하기</b>가 나옵니다.</div>
      <div className="row"><code className="cmd grow">{`$env:FLOWSMITH_WORKER_TOKEN="${token}"; node packages/worker/src/main.ts --server ${server} --headed`}</code><button className="small" type="button" onClick={() => { void navigator.clipboard?.writeText(`$env:FLOWSMITH_WORKER_TOKEN="${token}"; node packages/worker/src/main.ts --server ${server} --headed`).catch(() => undefined); }}><IconCopy size={13} /> Windows</button></div>
      <div className="row"><code className="cmd grow">{`FLOWSMITH_WORKER_TOKEN=${token} node packages/worker/src/main.ts --server ${server} --headed`}</code><button className="small" type="button" onClick={() => { void navigator.clipboard?.writeText(`FLOWSMITH_WORKER_TOKEN=${token} node packages/worker/src/main.ts --server ${server} --headed`).catch(() => undefined); }}><IconCopy size={13} /> macOS · Linux</button></div>
      {insecure && <div className="small"><b>https 주소가 아니라 앱이 붙지 않습니다.</b> 서버에 https를 설정하세요.</div>}
    </div>
  );
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
