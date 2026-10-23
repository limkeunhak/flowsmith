/**
 * API — 스크립트 · 다른 시스템에서 Flowsmith를 조회하고 제어한다.
 *
 *   #/api          API 목록 — Swagger UI(서버의 /api/openapi.json). «Try it out»은 지금 로그인으로 바로 부른다
 *   #/api/tokens   내 API 토큰 — 만들기(값은 이때 한 번) · 지우기. 역할은 내 역할 이하
 *
 * ★Swagger UI는 무거워서(1.5MB) 이 화면을 열 때만 받는다.
 */
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type ApiTokenRow } from "../api.ts";
import { IconCopy, IconKey, IconPlus, IconTrash, IconX } from "../icons.tsx";
import { ROLE_LABEL, useMe, type Role } from "../shell/me.ts";
import { dateTime } from "../format.ts";

const ROLES: Role[] = ["admin", "editor", "runner", "viewer"];
const RANK: Record<Role, number> = { viewer: 0, runner: 1, editor: 2, admin: 3 };
const DAYS: { v: number | null; label: string }[] = [{ v: 30, label: "30일" }, { v: 90, label: "90일" }, { v: 365, label: "1년" }, { v: null, label: "끝나지 않음" }];

export function ApiPage({ tab }: { tab: "list" | "tokens" }) {
  const me = useMe();
  return (
    <div className="page api-page">
      <div className="page-head">
        <h1 className="grow">API</h1>
        <a className="button" href="/api/openapi.json" target="_blank" rel="noreferrer">OpenAPI JSON</a>
      </div>
      <div className="page-sub">스크립트나 다른 시스템에서 워크플로우를 실행하고 기록 · 워커 · 대시보드를 조회합니다.</div>
      <div className="api-start card">
        <div><span className="api-start-k">기본 주소</span><code>{location.origin}/api</code></div>
        <div><span className="api-start-k">인증</span>{me.auth ? <><code>Authorization: Bearer fsa_…</code> <a href="#/api/tokens">토큰 만들기</a></> : <span className="muted">로그인을 끈 서버 — 토큰 없이 부릅니다</span>}</div>
        <div><span className="api-start-k">오류</span><code>{"{ error, problems? }"}</code></div>
      </div>
      <div className="seg-tabs api-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "list"} className={tab === "list" ? "on" : ""} onClick={() => { location.hash = "#/api"; }}>API 목록</button>
        <button role="tab" aria-selected={tab === "tokens"} className={tab === "tokens" ? "on" : ""} onClick={() => { location.hash = "#/api/tokens"; }}>내 토큰</button>
      </div>
      {tab === "list" ? <Swagger /> : <Tokens />}
    </div>
  );
}

function Swagger() {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | string>("loading");
  useEffect(() => {
    let dead = false;
    const el = host.current;
    void (async () => {
      try {
        const [{ default: SwaggerUIBundle }] = await Promise.all([import("swagger-ui-dist/swagger-ui-es-bundle.js"), import("swagger-ui-dist/swagger-ui.css")]);
        if (dead || !el) return;
        SwaggerUIBundle({
          domNode: el,
          url: "/api/openapi.json",
          deepLinking: false,               // 주소의 #은 편집 화면이 쓴다
          docExpansion: "list",
          defaultModelsExpandDepth: -1,     // 맨 아래 «Schemas»는 숨긴다
          displayRequestDuration: true,
          filter: true,
          tryItOutEnabled: false,
          onComplete: () => { if (!dead) setState("ready"); },
        });
      } catch (e) {
        if (!dead) setState(`API 목록을 불러오지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => { dead = true; if (el) el.replaceChildren(); };
  }, []);
  return (
    <>
      {state === "loading" && <div className="empty">불러오는 중…</div>}
      {state !== "loading" && state !== "ready" && <div className="banner bad">{state}</div>}
      <div className="card swagger-host" ref={host} hidden={state !== "ready"} />
    </>
  );
}

function Tokens() {
  const me = useMe();
  const [rows, setRows] = useState<ApiTokenRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const mine = me.user?.role ?? "viewer";
  const [form, setForm] = useState<{ name: string; role: Role; days: number | null }>({ name: "", role: mine, days: 90 });
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const load = () => api.listApiTokens().then(setRows, (e: Error) => setError(e.message));
  useEffect(() => { if (me.auth) void load(); }, [me.auth]);
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); } };

  if (!me.auth) {
    return (
      <div className="card empty-state">
        <b>이 서버는 로그인을 껐습니다</b>
        <span>토큰 없이 부르면 됩니다. 이 PC 밖으로 서버를 열면 로그인이 켜지고, 그때 여기서 토큰을 만듭니다.</span>
        <Curl token={null} />
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 16 }}>
      {error && <div className="banner bad">{error}</div>}
      {issued && (
        <div className="banner warn token-banner">
          <div className="row"><b className="grow">«{issued.name}» 토큰 — 지금 한 번만 표시됩니다</b><button className="icon-btn" title="닫기" onClick={() => setIssued(null)}><IconX /></button></div>
          <div className="row"><code className="token grow">{issued.token}</code><button className="small" type="button" onClick={() => copy(issued.token)}><IconCopy size={13} /> 복사</button></div>
          <Curl token={issued.token} />
        </div>
      )}
      <div className="row">
        <span className="grow small muted">토큰은 만든 사람의 이름으로 기록되고, 역할은 내 역할을 넘지 않습니다. 토큰으로는 새 토큰을 만들 수 없습니다.</span>
        {!adding && <button className="primary" onClick={() => { setAdding(true); setIssued(null); }}><IconPlus size={15} /> 토큰 만들기</button>}
      </div>
      {adding && (
        <form className="card stack" style={{ padding: 16, gap: 12 }} onSubmit={(e) => {
          e.preventDefault();
          void act(async () => { const r = await api.addApiToken({ ...form, name: form.name.trim() }); setIssued({ name: r.row.name, token: r.token }); setAdding(false); setForm({ name: "", role: mine, days: 90 }); });
        }}>
          <div className="row wrap">
            <label className="field grow"><span>이름</span><input autoFocus placeholder="예: 사내 대시보드" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field"><span>역할</span><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>{ROLES.filter((r) => RANK[r] <= RANK[mine]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
            <label className="field"><span>사용 기간</span><select value={String(form.days)} onChange={(e) => setForm({ ...form, days: e.target.value === "null" ? null : Number(e.target.value) })}>{DAYS.map((d) => <option key={String(d.v)} value={String(d.v)}>{d.label}</option>)}</select></label>
          </div>
          <div className="row"><span className="grow" /><button type="button" onClick={() => setAdding(false)}>그만두기</button><button className="primary" disabled={!form.name.trim()}>만들기</button></div>
        </form>
      )}
      <div className="card">
        {rows === null ? <div className="empty">불러오는 중…</div> : rows.length === 0 ? (
          <div className="empty-state"><IconKey size={20} /><b>아직 토큰이 없습니다</b><span>스크립트나 다른 시스템에서 부를 때 만드세요.</span></div>
        ) : (
          <div className="flow-rows">
            {rows.map((t) => {
              const over = t.expiresAt !== null && Date.parse(t.expiresAt) <= Date.now();
              return (
                <div key={t.id} className={`flow-row token-row${over ? " off" : ""}`}>
                  <IconKey size={16} />
                  <div className="grow">
                    <div className="name">{t.name} <span className="pill">{ROLE_LABEL[t.role]}</span>{over && <span className="pill bad" style={{ marginLeft: 6 }}>끝남</span>}</div>
                    <div className="meta">만든 때 {dateTime(t.createdAt)} · 마지막 사용 {t.lastUsedAt ? dateTime(t.lastUsedAt) : "없음"} · {t.expiresAt ? `${dateTime(t.expiresAt)}까지` : "끝나지 않음"}</div>
                  </div>
                  {deleting === t.id ? (
                    <>
                      <span className="small muted">바로 쓸 수 없게 됩니다</span>
                      <button className="small" onClick={() => setDeleting(null)}>그만두기</button>
                      <button className="small danger" onClick={() => { setDeleting(null); void act(() => api.deleteApiToken(t.id)); }}>지우기</button>
                    </>
                  ) : (
                    <button className="icon-btn" title="지우기" aria-label={`${t.name} 지우기`} onClick={() => setDeleting(t.id)}><IconTrash size={16} /></button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const copy = (t: string) => { void navigator.clipboard?.writeText(t).catch(() => undefined); };

/** 부르는 예 — 플로우 목록 · 실행 */
function Curl({ token }: { token: string | null }) {
  const auth = token ? ` -H "Authorization: Bearer ${token}"` : "";
  const list = `curl${auth} ${location.origin}/api/flows`;
  const run = `curl -X POST${auth} -H "content-type: application/json" -d "{}" ${location.origin}/api/flows/<워크플로우 id>/runs`;
  return (
    <div className="stack" style={{ gap: 6, alignSelf: "stretch" }}>
      <div className="row"><code className="cmd grow">{list}</code><button className="small" type="button" onClick={() => copy(list)}><IconCopy size={13} /> 목록</button></div>
      <div className="row"><code className="cmd grow">{run}</code><button className="small" type="button" onClick={() => copy(run)}><IconCopy size={13} /> 실행</button></div>
    </div>
  );
}
