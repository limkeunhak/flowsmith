/**
 * **확장**(젠킨스의 «플러그인 관리») — 확장 노드 묶음(.fspkg)을 올리고 · 사내 저장소에서 새 버전을 받고 · 켜고 끄고 · 되돌린다(PLAN §41).
 * 보기는 누구나 · 바꾸기는 관리자. 올린 버전은 남는다 — 고르면 바로 그 버전(재시작 없이 · 돌던 실행은 옛 것으로 끝까지).
 * ★서버에 고정된 확장(환경변수 FLOWSMITH_EXTENSIONS)은 여기서 바꾸지 않는다 — 목록에만 보인다.
 */
import { useEffect, useRef, useState } from "react";
import { api, ApiError, forgetExtensions, type PluginsView, type PluginView, type PluginSourceEntry } from "../api.ts";
import { IconAlert, IconCheck, IconPlus, IconTrash } from "../icons.tsx";
import { useMe } from "./me.ts";
import { ago } from "../format.ts";

const ACTION_LABEL: Record<string, string> = { install: "설치", activate: "버전 바꿈", rollback: "되돌림", enable: "켬", disable: "끔", remove: "지움", source: "저장소 주소" };
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

export function Plugins() {
  const me = useMe();
  const admin = me.can("admin");
  const [v, setV] = useState<PluginsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const load = () => api.listPlugins().then(setV, (e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  /** 바꾸고 다시 읽는다 — 편집 화면의 노드 목록도 새로 받게 한다 */
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null); setNote(null); setBusy(true);
    try { await fn(); forgetExtensions(); if (done) setNote(done); } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); void load(); }
  };
  const upload = (f: File) => act(async () => { const p = await api.uploadPlugin(f); setNote(`«${p.name}» ${p.version}을 올렸습니다 — 새로 시작하는 실행부터 이 버전입니다`); });

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="grow">확장</h1>
        {admin && <>
          <input ref={file} type="file" accept=".fspkg" hidden aria-label="묶음 파일" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
          <button className="primary" disabled={busy} onClick={() => file.current?.click()}><IconPlus size={15} /> 묶음 올리기(.fspkg)</button>
        </>}
      </div>
      <div className="page-sub">밖에서 만든 확장 노드를 설치하고 버전을 관리합니다. 워커에는 저절로 나눠 줍니다.</div>
      {error && <div className="banner bad" style={{ marginBottom: 12 }}>{error}</div>}
      {note && <div className="banner ok" style={{ marginBottom: 12 }}>{note}</div>}
      {v === null ? <div className="empty">불러오는 중…</div> : (
        <div className="stack plugin-page">
          <div className={`banner ${v.signing.required ? "" : "warn"} small`}>
            {v.signing.required
              ? v.signing.keys.length ? <>서명된 묶음만 받습니다 — 믿는 키 {v.signing.keys.map((k) => <span key={k.fingerprint} className="pill mono" title={`지문 ${k.fingerprint}`}>{k.name}</span>)}</>
                : <>서명된 묶음만 받는데 믿는 키가 없습니다 — 서버의 FLOWSMITH_PLUGIN_KEYS에 믿는 키 파일을 주세요</>
              : <>서명 없는 묶음도 받습니다(FLOWSMITH_PLUGIN_SIGNING=off) — 플러그인 코드는 서버 권한으로 돕니다. 사내 서명을 켜 두기를 권합니다</>}
          </div>

          <Source v={v} admin={admin} busy={busy} act={act} />

          <h2 className="section-title">설치된 플러그인</h2>
          {v.plugins.length === 0 && <div className="card empty-state"><b>설치된 플러그인이 없습니다</b><span>flowsmith-ext build로 만든 묶음(.fspkg)을 올리거나 사내 저장소에서 받으세요.</span></div>}
          {v.plugins.map((p) => <PluginCard key={p.id} p={p} admin={admin} busy={busy} act={act} />)}

          {v.builtIn.length > 0 && <>
            <h2 className="section-title">서버에 고정된 확장</h2>
            <div className="card plugin-builtin">
              <span className="small muted">환경변수 FLOWSMITH_EXTENSIONS로 실은 것 — 바꾸려면 서버 설정을 고치고 다시 켭니다.</span>
              <div className="row wrap" style={{ gap: 6 }}>{v.builtIn.map((e) => <span key={e.id} className="pill" title={e.id}>{e.title}</span>)}</div>
            </div>
          </>}

          {v.events.length > 0 && <>
            <h2 className="section-title">최근 기록</h2>
            <div className="card plugin-events">
              {v.events.map((e, i) => (
                <div key={i} className="row small"><span className="muted" style={{ minWidth: 90 }}>{ago(e.at)}</span><b>{ACTION_LABEL[e.action] ?? e.action}</b><span>{e.plugin === "-" ? "" : e.plugin}{e.version ? ` ${e.version}` : ""}</span><span className="muted grow">{e.note}</span>{e.by && <span className="muted">{e.by}</span>}</div>
              ))}
            </div>
          </>}
        </div>
      )}
    </div>
  );
}

function Source({ v, admin, busy, act }: { v: PluginsView; admin: boolean; busy: boolean; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const [url, setUrl] = useState(v.source ?? "");
  const [found, setFound] = useState<PluginSourceEntry[] | null>(null);
  useEffect(() => setUrl(v.source ?? ""), [v.source]);
  return (
    <div className="card stack plugin-source">
      <div className="row"><h2 className="grow">사내 저장소</h2>
        {v.source && <button disabled={busy} onClick={() => void act(async () => setFound((await api.checkPluginSource()).plugins))}>새 버전 확인</button>}
      </div>
      {admin ? (
        <form className="row" onSubmit={(e) => { e.preventDefault(); void act(() => api.setPluginSource(url.trim() || null), url.trim() ? "저장소 주소를 저장했습니다" : "저장소 주소를 지웠습니다"); }}>
          <input className="mono grow" placeholder="https://repo.사내/flowsmith-plugins/index.json" value={url} aria-label="사내 저장소 주소" onChange={(e) => setUrl(e.target.value)} />
          <button disabled={busy || url.trim() === (v.source ?? "")}>저장</button>
        </form>
      ) : <span className="small mono">{v.source ?? "정해지지 않음"}</span>}
      <span className="small muted">flowsmith-ext index로 만든 index.json 주소 — 받은 묶음도 해시 · 서명을 똑같이 봅니다.</span>
      {found && (found.length === 0 ? <span className="small muted">저장소에 묶음이 없습니다</span> : (
        <table className="plugin-found">
          <thead><tr><th>플러그인</th><th>버전</th><th>노드</th><th>서명</th><th /></tr></thead>
          <tbody>
            {found.map((e) => (
              <tr key={`${e.id}@${e.version}`}>
                <td><b>{e.name}</b> <span className="muted mono small">{e.id}</span></td>
                <td className="mono">{e.version}{e.installed === e.version && <span className="pill ok small">지금 쓰는 것</span>}{e.newer && <span className="pill accent small">새 버전</span>}</td>
                <td className="small">{e.nodes.length}개</td>
                <td className="small">{e.signer ?? "없음"}</td>
                <td>{admin && e.installed !== e.version && (
                  <button className="small" disabled={busy} onClick={() => void act(async () => { await api.installFromSource(e.id, e.version); setFound((await api.checkPluginSource()).plugins); }, `«${e.name}» ${e.version}으로 바꿨습니다`)}>
                    {e.have ? "이 버전으로" : e.installed ? "업데이트" : "설치"}
                  </button>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

function PluginCard({ p, admin, busy, act }: { p: PluginView; admin: boolean; busy: boolean; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const cur = p.versions.find((x) => x.version === p.version);
  return (
    <div className={`card plugin-card${p.enabled ? "" : " off"}`} data-plugin={p.id}>
      <div className="row">
        <span className={`worker-dot ${!p.enabled ? "off" : p.loaded ? "on" : "down"}`} />
        <b className="plugin-name">{p.name}</b><span className="mono small muted">{p.id}</span>
        <span className="pill mono" title="지금 쓰는 버전">{p.version}</span>
        <span className="grow" />
        {p.signer ? <span className="pill ok small" title="서명한 키"><IconCheck size={12} strokeWidth={2.6} /> {p.signer}</span> : <span className="pill warn small">서명 없음</span>}
        {!p.enabled && <span className="pill">꺼 둠</span>}
      </div>
      {p.description && <div className="small muted">{p.description}</div>}
      {p.error && <div className="banner bad small"><IconAlert size={13} /> 싣지 못했습니다 — {p.error}</div>}
      <div className="row wrap small" style={{ gap: 6 }}><span className="muted">노드</span>{p.nodes.map((n) => <span key={n.id} className="pill" title={n.id}>{n.title}</span>)}</div>
      <div className="small muted">{cur ? `${ago(cur.installedAt)} 올림${cur.installedBy ? ` · ${cur.installedBy}` : ""} · ${kb(cur.size)}${cur.source === "upload" ? "" : " · 사내 저장소"}` : ""}</div>
      {admin && (
        <div className="row" style={{ gap: 6 }}>
          <button className="small" disabled={busy} onClick={() => void act(() => api.updatePlugin(p.id, { enabled: !p.enabled }), p.enabled ? `«${p.name}»를 껐습니다 — 이 노드를 쓰는 실행은 «확장이 없습니다»로 멈춥니다` : `«${p.name}»를 켰습니다`)}>{p.enabled ? "끄기" : "켜기"}</button>
          {p.versions.length > 1 && (
            <label className="small muted row" style={{ gap: 6 }}>버전
              <select value={p.version} disabled={busy} aria-label="버전 고르기" onChange={(e) => void act(() => api.updatePlugin(p.id, { version: e.target.value }), `«${p.name}»를 ${e.target.value}으로 바꿨습니다`)}>
                {p.versions.map((x) => <option key={x.version} value={x.version}>{x.version}{x.version === p.version ? " (지금)" : ""} · {new Date(x.installedAt).toLocaleDateString("ko-KR")}</option>)}
              </select>
            </label>
          )}
          <span className="grow" />
          <button className="icon-btn" title="지우기 — 올린 버전을 모두 지웁니다" disabled={busy}
            onClick={() => { if (confirm(`«${p.name}» 플러그인을 지울까요? 올린 버전이 모두 지워집니다.`)) void act(() => api.deletePlugin(p.id), `«${p.name}»를 지웠습니다`); }}><IconTrash /></button>
        </div>
      )}
    </div>
  );
}
