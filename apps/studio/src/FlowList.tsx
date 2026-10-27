/**
 * 첫 화면 — «무엇을 자동화할까요?»(템플릿) · 내 플로우 목록.
 * ★비개발자가 빈 캔버스에서 막히지 않게 — 템플릿을 고르고 몇 가지만 답하면 뼈대가 짜인다(model/templates.ts).
 *  id는 사람이 짓지 않는다(자동). 빈 플로우는 누르면 바로 만들어 캔버스로 가고 거기서 이름을 묻는다(editor/NameModal.tsx).
 */
import { useEffect, useState } from "react";
import { describeCron, EMAIL_RE, recipientsOf, type Flow, type NodeType, explainProblems, problemLine } from "@flowsmith/core";
import { NODE_META } from "./editor/nodeMeta.tsx";
import { NEW_FLOW_KEY } from "./editor/NameModal.tsx";
import { aiBridge } from "./ai/bridge.ts";
import { useMe } from "./shell/me.ts";
import { api, ApiError, type FlowSummary } from "./api.ts";
import { blankFlow, newFlowId, SCHEDULE_CHOICES, TEMPLATES, type FlowChoice, type Template } from "./model/index.ts";
import { IconAlert, IconBranch, IconCheck, IconPlay, IconPlus, IconSearch, IconTrash, IconX } from "./icons.tsx";
import { EmptyState } from "./EmptyState.tsx";
import { ago } from "./format.ts";


/** 파일 쓰기 노드가 있는 플로우들 — «모은 목록의 행마다» 템플릿이 고른다 */
async function flowChoices(flows: FlowSummary[]): Promise<FlowChoice[]> {
  const out: FlowChoice[] = [];
  for (const f of flows) {
    const d = await api.getFlow(f.id).catch(() => null);
    const files = (d?.draft.nodes ?? []).flatMap((n) => (n.type === "fileWrite" ? [{ name: n.config.target.name, format: n.config.target.format }] : []));
    if (files.length) out.push({ id: f.id, name: f.name, files });
  }
  return out;
}

function TemplateForm({ t, flows, onCancel, onCreate }: { t: Template; flows: FlowSummary[]; onCancel: () => void; onCreate: (drafts: Flow[]) => Promise<void> }) {
  const [name, setName] = useState(t.title);
  const [a, setA] = useState<Record<string, string>>(() => Object.fromEntries(t.asks.filter((x) => x.kind === "schedule").map((x) => [x.key, SCHEDULE_CHOICES[0]!.label])));
  const [choices, setChoices] = useState<FlowChoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (t.asks.some((x) => x.kind === "flow")) void flowChoices(flows).then(setChoices); }, [t.id]);
  const problem = (k: string): string | null => {
    const ask = t.asks.find((x) => x.key === k)!;
    const v = (a[k] ?? "").trim();
    if (v === "") return ask.required ? "필요합니다" : null;
    if (ask.kind === "url" && !/^https?:\/\/\S+$/i.test(v)) return "http:// 또는 https://로 시작하는 주소를 붙여 넣으세요";
    if (ask.kind === "email" && recipientsOf(v).some((x) => !EMAIL_RE.test(x))) return "메일 주소를 확인하세요";
    return null;
  };
  const ok = name.trim() !== "" && t.asks.every((x) => problem(x.key) === null);
  return (
    <div className="card stack tpl-form">
      <div className="row"><h2 className="grow">{t.title}</h2><button className="icon-btn" title="닫기" onClick={onCancel}><IconX /></button></div>
      <div className="small muted">{t.desc}</div>
      <label className="field"><span>워크플로우 이름</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      {t.asks.map((x) => (
        <label key={x.key} className="field">
          <span>{x.label}{x.required ? "" : " (선택)"}</span>
          {x.kind === "schedule" ? (
            <select value={a[x.key] ?? ""} onChange={(e) => setA({ ...a, [x.key]: e.target.value })}>
              {SCHEDULE_CHOICES.map((c) => <option key={c.label}>{c.label}</option>)}
            </select>
          ) : x.kind === "flow" ? (
            choices === null ? <span className="small muted">워크플로우를 살펴보는 중…</span>
              : choices.length === 0 ? <span className="small" style={{ color: "var(--warn)" }}>파일 쓰기 노드가 있는 워크플로우가 아직 없습니다 — 먼저 «매일 목록 모아 메일로 받기»로 목록을 모으세요</span>
              : (
                <select value={a[x.key] ?? ""} onChange={(e) => setA({ ...a, [x.key]: e.target.value })}>
                  <option value="">(고르세요)</option>
                  {choices.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.files.map((f) => f.name).join(", ")}</option>)}
                </select>
              )
          ) : (
            <input type={x.kind === "email" ? "email" : "text"} value={a[x.key] ?? ""} placeholder={x.placeholder} onChange={(e) => setA({ ...a, [x.key]: e.target.value })} />
          )}
          {a[x.key]?.trim() && problem(x.key) ? <span className="small" style={{ color: "var(--bad)" }}>{problem(x.key)}</span> : x.hint ? <span className="small muted">{x.hint}</span> : null}
        </label>
      ))}
      <div className="tpl-steps small">
        <span className="muted">만들어지는 것:</span> {t.steps.map((s, i) => <span key={i} className="pill">{i + 1}. {s}</span>)}
      </div>
      <div className="row"><span className="small muted grow">웹페이지 동작은 다음 화면에서 직접 해 보며 녹화합니다.</span>
        <button onClick={onCancel}>그만두기</button>
        <button className="primary" disabled={!ok || busy} onClick={() => {
          setBusy(true);
          const taken = flows.map((f) => f.id);
          const drafts = t.build(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.trim()])), name.trim(), { newId: (base) => { const id = newFlowId(base, taken); taken.push(id); return id; }, flows: choices ?? [] });
          void onCreate(drafts).finally(() => setBusy(false));
        }}>만들기</button>
      </div>
    </div>
  );
}

/** only — "templates"면 템플릿만(사이드바의 «템플릿») */
export function FlowList({ only = null }: { only?: "templates" | null }) {
  const me = useMe();
  // 새 플로우를 둘 팀 — 내 팀이 있으면 첫 팀, 없으면 공용
  const [team, setTeam] = useState<string>(() => me.teams[0]?.id ?? "");
  const [flows, setFlows] = useState<FlowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"none" | "import">("none");
  const [picked, setPicked] = useState<Template | null>(null);
  const [q, setQ] = useState("");
  const [json, setJson] = useState("");

  const load = () => api.listFlows().then(setFlows, (e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  /** 차례로 만들고 마지막 것을 연다 */
  async function create(drafts: unknown[], blank = false) {
    setError(null);
    try {
      let last = "";
      for (const d of drafts) last = (await api.createFlow(d, team || null)).id;
      // 빈 플로우 — 캔버스가 이름을 묻는다(그만두면 지운다)
      if (blank) try { sessionStorage.setItem(NEW_FLOW_KEY, last); } catch { /* 저장소가 막혀도 만들기는 된다 */ }
      location.hash = `#/flows/${encodeURIComponent(last)}`;
    } catch (e) {
      setError(e instanceof ApiError ? [e.message, ...explainProblems(e.problems).map(problemLine)].join(" · ") : String(e));
    }
  }
  /** 빈 플로우 — 바로 만들고 캔버스로 간다 */
  const [starting, setStarting] = useState(false);
  const startBlank = () => {
    if (starting) return;
    setStarting(true);
    void create([blankFlow(newFlowId("flow", (flows ?? []).map((f) => f.id)), "새 워크플로우")], true).finally(() => setStarting(false));
  };

  async function remove(f: FlowSummary) {
    if (!confirm(`'${f.name}' 워크플로우를 지울까요? 버전 · 시크릿 · 실행 기록도 함께 지워집니다.`)) return;
    await api.deleteFlow(f.id).catch((e: Error) => setError(e.message));
    void load();
  }

  const [only2, setOnly2] = useState<"all" | "published" | "todo" | "failed">("all");
  const counts = {
    all: (flows ?? []).length,
    published: (flows ?? []).filter((f) => f.activeVersion !== null).length,
    todo: (flows ?? []).filter((f) => f.problems > 0).length,
    failed: (flows ?? []).filter((f) => f.lastRun?.status === "failure" || (f.monitor && (f.monitor.status === "broken" || f.monitor.status === "changed"))).length,
  };
  const shown = (flows ?? [])
    .filter((f) => q.trim() === "" || `${f.name} ${f.id}`.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((f) => only2 === "all" || (only2 === "published" ? f.activeVersion !== null : only2 === "todo" ? f.problems > 0
      : f.lastRun?.status === "failure" || (f.monitor !== null && (f.monitor.status === "broken" || f.monitor.status === "changed"))));
  const open = (m: typeof mode) => { setPicked(null); setMode(mode === m ? "none" : m); };

  const hasFlows = flows !== null && flows.length > 0;
  const templates = (
    <>
      <h2 className="section-title">{hasFlows && only !== "templates" ? "템플릿으로 시작하기" : "무엇을 자동화할까요?"}</h2>
      {picked ? (
        <TemplateForm t={picked} flows={flows ?? []} onCancel={() => setPicked(null)} onCreate={(d) => create(d)} />
      ) : (
        <div className="tpl-grid">
          {TEMPLATES.map((t) => (
            <button key={t.id} className="tpl-card" onClick={() => { setMode("none"); setPicked(t); }}>
              <span className="tpl-title">{t.title}</span>
              <span className="tpl-desc">{t.desc}</span>
              <span className="tpl-flow">{t.steps.join(" → ")}</span>
            </button>
          ))}
          <button className="tpl-card blank" disabled={starting} onClick={startBlank}>
            <span className="tpl-title"><IconPlus size={15} /> 빈 워크플로우에서</span>
            <span className="tpl-desc">처음부터 직접 단계를 이어 붙입니다</span>
          </button>
        </div>
      )}
    </>
  );

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="grow">{only === "templates" ? "템플릿" : "워크플로우"}</h1>
        <button onClick={() => open("import")}>JSON 가져오기</button>
        {me.can("editor") && <button className="ai-btn" onClick={() => aiBridge.open()}><span className="ai-spark" aria-hidden="true">✦</span> AI로 만들기</button>}
        <button className="primary" disabled={starting} onClick={startBlank}><IconPlus size={15} /> 빈 워크플로우</button>
      </div>
      {me.auth && (me.teams.length > 0) && (
        <label className="team-pick small">새 워크플로우를 둘 곳
          <select value={team} onChange={(e) => setTeam(e.target.value)}>
            {me.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value="">공용(모두가 봄)</option>
          </select>
        </label>
      )}
      <div className="page-sub">{only === "templates" ? "하고 싶은 일을 고르면 뼈대를 만들어 드립니다." : "반복하는 웹 작업을 녹화해 두고, 정한 때마다 자동으로 실행합니다."}</div>

      {error && <div className="banner bad" style={{ marginBottom: 12 }}>{error}</div>}

      {mode === "import" && (
        <div className="card stack" style={{ padding: 16, marginBottom: 16 }}>
          <span className="small muted">워크플로우 JSON을 붙여 넣으세요 (예: examples/login-and-read.json)</span>
          <textarea className="code" style={{ minHeight: 160 }} value={json} onChange={(e) => setJson(e.target.value)} />
          <div className="row"><span className="grow" />
            <button onClick={() => setMode("none")}>그만두기</button>
            <button className="primary" disabled={json.trim() === ""} onClick={() => {
              try { void create([JSON.parse(json)]); } catch { setError("JSON을 읽을 수 없습니다"); }
            }}>가져오기</button>
          </div>
        </div>
      )}

      {/* 템플릿 — 처음 온 사람에게는 위에, 워크플로우가 있는 사람에게는 「내 워크플로우」 아래에(불러오는 동안은 두지 않는다 · 자리가 튀지 않게) */}
      {(only === "templates" || (flows !== null && !hasFlows)) && templates}
      {only !== "templates" && <>
      <h2 className="section-title">내 워크플로우</h2>
      {flows !== null && flows.length > 0 && (
        <div className="list-tools">
          <label className="search"><IconSearch /><input placeholder="워크플로우 찾기" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="seg-tabs small">
            {([["all", "전체"], ["published", "게시됨"], ["todo", "할 일 있음"], ["failed", "실패 · 바뀜"]] as const).map(([k, label]) => (
              <button key={k} className={only2 === k ? "on" : ""} onClick={() => setOnly2(k)}>{label} <span className="muted">{counts[k]}</span></button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        {flows === null ? <div className="empty">불러오는 중…</div>
          : flows.length === 0 ? <EmptyState bare icon={<IconBranch size={22} />} title="아직 워크플로우가 없습니다">위에서 하고 싶은 일을 고르거나 빈 워크플로우로 시작하세요.</EmptyState>
          : shown.length === 0 ? <div className="empty">맞는 워크플로우가 없습니다</div>
          : (
            <div className="flow-rows">
              {shown.map((f) => (
                <div key={f.id} className="flow-row" role="link" tabIndex={0}
                  onClick={() => { location.hash = `#/flows/${encodeURIComponent(f.id)}`; }}
                  onKeyDown={(e) => { if (e.key === "Enter") location.hash = `#/flows/${encodeURIComponent(f.id)}`; }}>
                  <div className="flow-icons" aria-hidden="true">
                    {(f.nodeTypes ?? []).filter((t): t is NodeType => t in NODE_META).slice(0, 4).map((t) => { const Icon = NODE_META[t].icon; return <span key={t} className={`mini-tile t-${t}`} title={NODE_META[t].title}><Icon size={16} /></span>; })}
                    {(f.nodeTypes ?? []).length === 0 && <span className="mini-tile empty" title="노드 없음" />}
                  </div>
                  <div className="grow">
                    <div className="name">{f.name}{me.auth && <span className={`pill team-pill${f.team ? "" : " shared"}`}>{f.team?.name ?? "공용"}</span>}</div>
                    <div className="meta">
                      {ago(f.updatedAt)} 고침
                      {(f.schedules ?? []).length > 0 && <> · {(() => { try { return describeCron(f.schedules![0]!); } catch { return "일정"; } })()}{f.schedules!.length > 1 ? ` 외 ${f.schedules!.length - 1}` : ""}</>}
                      {f.lastRun && <> · 마지막 실행 <span className={`last-run st-${f.lastRun.status}`}>{f.lastRun.status === "success" ? "성공" : f.lastRun.status === "failure" ? "실패" : f.lastRun.status === "blocked" ? "막힘" : "멈춤"}</span> {ago(f.lastRun.at)}</>}
                    </div>
                  </div>
                  {f.problems > 0 && <span className="pill bad"><IconAlert size={12} /> 할 일 {f.problems}</span>}
                  {f.monitor && f.monitor.status !== "ok" && f.monitor.status !== "running" && (
                    <span className={`pill ${f.monitor.status === "changed" ? "warn" : "bad"}`} title={`변경 감시 · ${new Date(f.monitor.at).toLocaleString("ko-KR")}`}>
                      <IconAlert size={12} /> {f.monitor.status === "changed" ? "사이트 바뀜" : f.monitor.status === "broken" ? "사이트 깨짐" : "감시 못 함"}
                    </span>
                  )}
                  {f.activeVersion === null ? <span className="pill">게시 안 됨</span> : <span className="pill ok"><IconCheck size={12} strokeWidth={2.6} /> 게시됨 v{f.activeVersion}</span>}
                  {f.activeVersion !== null && me.can("runner") && (
                    <a className="icon-btn" href={`#/run/${encodeURIComponent(f.id)}`} title="실행 폼 — 입력만 넣고 게시된 버전을 돌립니다(이 주소를 실행자에게 주세요)" onClick={(e) => e.stopPropagation()}><IconPlay size={16} /></a>
                  )}
                  <button className="icon-btn" title="지우기" onClick={(e) => { e.stopPropagation(); void remove(f); }}><IconTrash /></button>
                </div>
              ))}
            </div>
          )}
      </div>
      </>}
      {only !== "templates" && hasFlows && templates}
    </div>
  );
}
