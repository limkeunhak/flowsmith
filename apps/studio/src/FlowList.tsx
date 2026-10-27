/**
 * 첫 화면 — «무엇을 자동화할까요?»(템플릿) · 내 플로우 목록.
 * 목록은 묶음(워크플로우의 이름표 — 초안 밖)으로 접고 펴며, 살펴볼 것(문제 · 실패 · 사이트 바뀜)을 맨 위에 모은다(model/flowList.ts).
 * 여럿을 골라 묶음을 옮기거나 지우고 · 줄을 묶음 머리로 끌어 옮긴다. 이름 앞말(«Navigator · …»)이 같은 것은 묶음으로 정리하자고 제안한다.
 * 템플릿은 워크플로우가 없을 때만 이 화면에 — 있으면 «템플릿» 화면으로.
 * ★비개발자가 빈 캔버스에서 막히지 않게 — 템플릿을 고르고 몇 가지만 답하면 뼈대가 짜인다(model/templates.ts).
 *  id는 사람이 짓지 않는다(자동). 빈 플로우는 누르면 바로 만들어 캔버스로 가고 거기서 이름을 묻는다(editor/NameModal.tsx).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { describeCron, EMAIL_RE, recipientsOf, type Flow, explainProblems, problemLine } from "@flowsmith/core";
import { NEW_FLOW_KEY } from "./editor/NameModal.tsx";
import { aiBridge } from "./ai/bridge.ts";
import { useMe } from "./shell/me.ts";
import { api, ApiError, type FlowSummary } from "./api.ts";
import { blankFlow, groupFlows, groupNames, matchesQuery, needsAttention, newFlowId, SCHEDULE_CHOICES, sortFlows, SORT_LABEL, suggestGroups, TEMPLATES, type FlowChoice, type FlowSort, type Template } from "./model/index.ts";
import { IconAlert, IconBranch, IconCheck, IconChevronDown, IconCopy, IconFolder, IconPlay, IconPlus, IconSearch, IconTrash, IconX } from "./icons.tsx";
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

type ListFilter = "all" | "draft" | "todo" | "failed";
const VIEW_KEY = "flowsmith.flowList.view";
/** 목록을 떠날 때의 모습 — 이 탭에서만(sessionStorage · 새 탭은 처음부터) */
function readView(): { q: string; only: ListFilter; scroll: number } {
  try { const v = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? "null") as { q?: unknown; only?: unknown; scroll?: unknown } | null;
    return { q: typeof v?.q === "string" ? v.q : "", only: (["all", "draft", "todo", "failed"] as const).find((x) => x === v?.only) ?? "all", scroll: typeof v?.scroll === "number" ? v.scroll : 0 };
  } catch { return { q: "", only: "all", scroll: 0 }; }
}
function writeView(v: { q: string; only: ListFilter; scroll: number }): void {
  try { sessionStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* 기억 못 해도 된다 */ }
}
const SORT_KEY = "flowsmith.flowList.sort";
const FOLD_KEY = "flowsmith.flowList.folded";
const FOLD_OVER = 20;
const SUGGEST_KEY = "flowsmith.flowList.suggestOff";
/** 끌어 옮기는 줄들 — 다른 것을 끌어 와도 묶음 머리가 받지 않게 우리 형식으로 */
const DRAG = "application/x-flowsmith-flows";
/** 이 브라우저의 보기 설정(정렬 · 접은 묶음) — 저장소가 막혀도 목록은 뜬다 */
function readPref<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v === null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
}
function writePref(key: string, v: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 기억 못 해도 된다 */ }
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
  // 이 탭에서 목록을 떠날 때의 모습(찾기 · 거르기 · 스크롤) — 워크플로우를 열었다 돌아오면 그 자리로
  const back = useRef(readView());
  const [q, setQ] = useState(only === "templates" ? "" : back.current.q);
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

  /** 복제 — 초안만 «이름 (사본)»으로. 만들고 나면 그 캔버스로 */
  async function duplicate(f: FlowSummary) {
    setError(null);
    try {
      const d = await api.duplicateFlow(f.id);
      location.hash = `#/flows/${encodeURIComponent(d.id)}`;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  const [only2, setOnly2] = useState<ListFilter>(only === "templates" ? "all" : back.current.only);
  const list = useRef({ q, only: only2, scroll: 0 });
  list.current.q = q;
  list.current.only = only2;
  useEffect(() => {
    if (only === "templates") return;
    const main = document.querySelector(".app-main");
    const on = () => { list.current.scroll = main?.scrollTop ?? 0; };
    main?.addEventListener("scroll", on, { passive: true });
    return () => { main?.removeEventListener("scroll", on); writeView(list.current); };
  }, [only]);
  // 돌아왔으면 — 목록이 그려진 뒤 한 번 그 자리로(그리기 전에 옮기면 짧은 화면에 막혀 0이 된다)
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current || flows === null || only === "templates") return;
    restored.current = true;
    const main = document.querySelector(".app-main");
    if (main && back.current.scroll > 0) { main.scrollTop = back.current.scroll; list.current.scroll = main.scrollTop; }
  });
  const [sort, setSort] = useState<FlowSort>(() => readPref<FlowSort>(SORT_KEY, "updated"));
  // 묶음마다 접었나 — 사람이 고른 것만 기억한다. 고른 적 없으면 많을 때(20개 넘게) 접어 묶음 머리만 보인다
  const [folded, setFolded] = useState<Record<string, boolean>>(() => readPref<Record<string, boolean>>(FOLD_KEY, {}));
  const all = flows ?? [];
  const isFailed = (f: FlowSummary) => f.lastRun?.status === "failure" || (f.monitor !== null && (f.monitor.status === "broken" || f.monitor.status === "changed"));
  const counts = {
    all: all.length,
    draft: all.filter((f) => f.activeVersion === null).length,
    todo: all.filter((f) => f.problems > 0).length,
    failed: all.filter(isFailed).length,
  };
  const shown = useMemo(() => sortFlows(all
    .filter((f) => matchesQuery(f, q))
    .filter((f) => only2 === "all" || (only2 === "draft" ? f.activeVersion === null : only2 === "todo" ? f.problems > 0 : isFailed(f))), sort),
  [flows, q, only2, sort]);
  const groups = useMemo(() => groupFlows(shown), [shown]);
  const searching = q.trim() !== "";
  // 살펴볼 것 — 많을 때(묶음을 접어 둘 때) · 거르지도 찾지도 않을 때만 맨 위에(묶음 안에도 그대로 있다). 적으면 한눈에 보인다
  const attention = all.length > FOLD_OVER && only2 === "all" && !searching ? shown.filter(needsAttention) : [];
  const shutOf = (g: string) => folded[g] ?? all.length > FOLD_OVER;
  const toggleFold = (g: string) => setFolded((v) => { const next = { ...v, [g]: !(v[g] ?? all.length > FOLD_OVER) }; writePref(FOLD_KEY, next); return next; });
  const open = (m: typeof mode) => { setPicked(null); setMode(mode === m ? "none" : m); };

  // ── 묶음 옮기기 · 여럿 고르기 · 끌어 놓기 ──
  const canEdit = me.can("editor");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [newGroup, setNewGroup] = useState("");
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [suggestOff, setSuggestOff] = useState(() => readPref<boolean>(SUGGEST_KEY, false));
  const names = useMemo(() => groupNames(all), [flows]);
  const suggestions = useMemo(() => (canEdit && !suggestOff ? suggestGroups(all) : []), [flows, canEdit, suggestOff]);
  const pick = (ids: string[], on: boolean) => setSel((v) => { const n = new Set(v); for (const id of ids) on ? n.add(id) : n.delete(id); return n; });
  // 지워졌거나 걸러져 안 보이는 것은 고른 데서 뺀다 — 보이지 않는 것을 옮기거나 지우지 않게
  useEffect(() => { setSel((v) => { const seen = new Set(shown.map((f) => f.id)); const n = new Set([...v].filter((id) => seen.has(id))); return n.size === v.size ? v : n; }); }, [shown]);

  /** 옮긴다 — 목록을 다시 받지 않고 그 자리에서 바꾼다(고친 때도 그대로라 차례가 흔들리지 않는다). reveal — 옮긴 묶음을 편다 */
  async function move(ids: string[], group: string | null, reveal = true) {
    if (ids.length === 0) return;
    setError(null);
    try {
      const r = await api.setFlowGroup(ids, group);
      setFlows((fs) => (fs ?? []).map((f) => (ids.includes(f.id) ? { ...f, group: r.group } : f)));
      // 옮긴 곳이 접혀 있으면 편다 — 어디로 갔는지 보이게
      if (reveal) setFolded((v) => { const k = r.group ?? ""; if (v[k] === false) return v; const next = { ...v, [k]: false }; writePref(FOLD_KEY, next); return next; });
      setNote(`${ids.length}개를 ${r.group ? `«${r.group}»` : "묶음 없음"}(으)로 옮겼습니다`);
      setSel(new Set()); setMoving(false); setNewGroup("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function removeMany(ids: string[]) {
    if (!confirm(`고른 워크플로우 ${ids.length}개를 지울까요? 버전 · 시크릿 · 실행 기록도 함께 지워집니다.`)) return;
    for (const id of ids) await api.deleteFlow(id).catch((e: Error) => setError(e.message));
    setSel(new Set());
    void load();
  }
  async function applySuggestions() {
    // 한꺼번에 정리할 때는 펴지 않는다 — 묶음 머리만 보여야 정리된 것이 보인다
    for (const s of suggestions) await move(s.ids, s.group, false);
    setNote(`묶음 ${suggestions.length}개로 정리했습니다 — ${suggestions.map((s) => `${s.group} ${s.ids.length}`).join(" · ")}`);
  }
  const dragIds = (f: FlowSummary) => (sel.has(f.id) ? [...sel] : [f.id]);
  /** 묶음 머리 — 끌어 놓을 자리 */
  const dropProps = (target: string | null) => (canEdit ? {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); setDropOn(target ?? ""); } },
    onDragLeave: () => setDropOn((v) => (v === (target ?? "") ? null : v)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDropOn(null); const ids = e.dataTransfer.getData(DRAG).split("\n").filter(Boolean); void move(ids, target); },
  } : {});

  const hasFlows = flows !== null && flows.length > 0;
  const templates = (
    <>
      <h2 className="section-title">무엇을 자동화할까요?</h2>
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

  const row = (f: FlowSummary, label: string) => (
    <div key={f.id} className={`flow-row${sel.has(f.id) ? " picked" : ""}`} role="link" tabIndex={0}
      draggable={canEdit}
      onDragStart={(e) => { e.dataTransfer.setData(DRAG, dragIds(f).join("\n")); e.dataTransfer.effectAllowed = "move"; }}
      onClick={() => { location.hash = `#/flows/${encodeURIComponent(f.id)}`; }}
      onKeyDown={(e) => { if (e.key === "Enter") location.hash = `#/flows/${encodeURIComponent(f.id)}`; }}>
      <div className="flow-cell-pick" onClick={(e) => e.stopPropagation()}>
        {canEdit && <input type="checkbox" aria-label={`${f.name} 고르기`} checked={sel.has(f.id)} onChange={(e) => pick([f.id], e.target.checked)} />}
      </div>
      <div className="flow-cell-name">
        <div className="name" title={f.name}><span className="flow-label">{label}</span>{me.auth && <span className={`pill team-pill${f.team ? "" : " shared"}`}>{f.team?.name ?? "공용"}</span>}</div>
        {f.description && <div className="desc" title={f.description}>{f.description}</div>}
      </div>
      <div className="flow-cell-state">
        {f.problems > 0 && <span className="pill bad"><IconAlert size={12} /> 할 일 {f.problems}</span>}
        {f.monitor && f.monitor.status !== "ok" && f.monitor.status !== "running" && (
          <span className={`pill ${f.monitor.status === "changed" ? "warn" : "bad"}`} title={`변경 감시 · ${new Date(f.monitor.at).toLocaleString("ko-KR")}`}>
            <IconAlert size={12} /> {f.monitor.status === "changed" ? "사이트 바뀜" : f.monitor.status === "broken" ? "사이트 깨짐" : "감시 못 함"}
          </span>
        )}
        {f.activeVersion === null ? <span className="pill">게시 안 됨</span> : <span className="pill ok" title={`게시된 버전 v${f.activeVersion}`}><IconCheck size={12} strokeWidth={2.6} /> v{f.activeVersion}</span>}
      </div>
      <div className="flow-cell-run">
        {f.lastRun ? <><span className={`last-run st-${f.lastRun.status}`}>{f.lastRun.status === "success" ? "성공" : f.lastRun.status === "failure" ? "실패" : f.lastRun.status === "blocked" ? "막힘" : "멈춤"}</span> <span className="faint">{ago(f.lastRun.at)}</span></> : <span className="faint">—</span>}
      </div>
      <div className="flow-cell-when" title={(f.schedules ?? []).join("\n") || undefined}>
        {(f.schedules ?? []).length > 0 ? <>{(() => { try { return describeCron(f.schedules![0]!); } catch { return "일정"; } })()}{f.schedules!.length > 1 ? ` 외 ${f.schedules!.length - 1}` : ""}</> : <span className="faint">—</span>}
      </div>
      <div className="flow-cell-updated faint">{ago(f.updatedAt)}</div>
      <div className="flow-cell-tools">
        {f.activeVersion !== null && me.can("runner") && (
          <a className="icon-btn" href={`#/run/${encodeURIComponent(f.id)}`} title="실행 폼 — 입력만 넣고 게시된 버전을 돌립니다(이 주소를 실행자에게 주세요)" onClick={(e) => e.stopPropagation()}><IconPlay size={16} /></a>
        )}
        {me.can("editor") && <button className="icon-btn" title="복제 — 초안만 «이름 (사본)»으로 만듭니다(버전 · 실행 기록 · 시크릿 값은 안 가져갑니다)" onClick={(e) => { e.stopPropagation(); void duplicate(f); }}><IconCopy /></button>}
        <button className="icon-btn" title="지우기" onClick={(e) => { e.stopPropagation(); void remove(f); }}><IconTrash /></button>
      </div>
    </div>
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

      {/* 템플릿 — 워크플로우가 없을 때만 이 화면에(불러오는 동안은 두지 않는다 · 자리가 튀지 않게). 있으면 «템플릿» 화면으로 */}
      {(only === "templates" || (flows !== null && !hasFlows)) && templates}
      {only !== "templates" && <>
      <h2 className="section-title">내 워크플로우</h2>
      {hasFlows && (
        <div className="list-tools">
          <label className="search"><IconSearch /><input placeholder="이름 · 설명으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          {/* 0개인 거르기는 감춘다 — 고를 것이 없다 */}
          <div className="seg-tabs small">
            {([["all", "전체"], ["todo", "할 일 있음"], ["failed", "실패 · 바뀜"], ["draft", "게시 안 됨"]] as const).filter(([k]) => k === "all" || counts[k] > 0 || only2 === k).map(([k, label]) => (
              <button key={k} className={only2 === k ? "on" : ""} onClick={() => setOnly2(k)}>{label} <span className="muted">{counts[k]}</span></button>
            ))}
          </div>
          <span className="grow" />
          <label className="flow-sort small muted">정렬
            <select value={sort} onChange={(e) => { const v = e.target.value as FlowSort; setSort(v); writePref(SORT_KEY, v); }}>
              {(Object.keys(SORT_LABEL) as FlowSort[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
            </select>
          </label>
        </div>
      )}

      {flows === null ? <div className="card"><div className="empty">불러오는 중…</div></div>
        : !hasFlows ? <div className="card"><EmptyState bare icon={<IconBranch size={22} />} title="아직 워크플로우가 없습니다">위에서 하고 싶은 일을 고르거나 빈 워크플로우로 시작하세요.</EmptyState></div>
        : shown.length === 0 ? <div className="card"><div className="empty">맞는 워크플로우가 없습니다</div></div>
        : (
          <div className={`flow-list${sel.size ? " picking" : ""}`}>
            {suggestions.length > 0 && (
              <div className="banner info flow-suggest">
                <IconFolder size={16} />
                <span className="grow">이름 앞말이 같은 워크플로우를 묶음으로 정리할까요? — {suggestions.slice(0, 4).map((x) => `${x.group} ${x.ids.length}`).join(" · ")}{suggestions.length > 4 ? ` 외 ${suggestions.length - 4}` : ""}</span>
                <button className="primary small" onClick={() => void applySuggestions()}>묶음으로 정리</button>
                <button className="ghost small" onClick={() => { setSuggestOff(true); writePref(SUGGEST_KEY, true); }}>그만두기</button>
              </div>
            )}
            {note && <div className="flow-note small" role="status">{note} <button className="ghost small" onClick={() => setNote(null)} aria-label="닫기"><IconX size={12} /></button></div>}
            <div className="flow-cols" aria-hidden="true"><span /><span>이름</span><span>상태</span><span>마지막 실행</span><span>일정</span><span>고침</span><span /></div>
            {attention.length > 0 && (
              <section className="flow-group attention">
                <div className="flow-group-head static"><span className="flow-group-fold" /><span className="flow-group-slot"><IconAlert size={14} /></span>살펴볼 것 <span className="flow-group-count">{attention.length}</span></div>
                <div className="card flow-rows">{attention.map((f) => row(f, f.name))}</div>
              </section>
            )}
            {groups.map((g) => {
              // 묶음이 하나도 없으면 머리 없이 한 장으로
              if (g.name === null && groups.length === 1) return <div key="all" className="card flow-rows">{g.flows.map((x) => row(x.flow, x.label))}</div>;
              const key = g.name ?? "";
              const shut = !searching && shutOf(key);
              const ids = g.flows.map((x) => x.flow.id);
              const allOn = ids.every((id) => sel.has(id));
              return (
                <section key={key} className={`flow-group${dropOn === key ? " drop" : ""}`} {...dropProps(g.name)}>
                  {/* 머리의 칸은 줄과 같다 — 접기(왼쪽 여백) · 고르기 칸 · 이름(줄의 이름과 같은 자리에서 시작) */}
                  <div className="flow-group-head">
                    <button type="button" className="flow-group-fold" aria-label={shut ? "펴기" : "접기"} aria-expanded={!shut} onClick={() => toggleFold(key)}><IconChevronDown size={14} className={shut ? "fold shut" : "fold"} /></button>
                    <span className="flow-group-slot">{canEdit && <input type="checkbox" className="flow-group-pick" aria-label={`${g.name ?? "묶음 없음"} 모두 고르기`} checked={allOn} onChange={(e) => pick(ids, e.target.checked)} />}</span>
                    {renaming && renaming.from === key ? (
                      <form className="flow-group-rename" onSubmit={(e) => { e.preventDefault(); const to = renaming.to.trim(); setRenaming(null); if (to && to !== key) void move(all.filter((f) => f.group === g.name).map((f) => f.id), to); }}>
                        <input autoFocus aria-label="묶음 이름" value={renaming.to} maxLength={40} onChange={(e) => setRenaming({ from: key, to: e.target.value })} onKeyDown={(e) => { if (e.key === "Escape") setRenaming(null); }} />
                        <button className="primary small">바꾸기</button>
                        <button type="button" className="ghost small" onClick={() => setRenaming(null)}>그만두기</button>
                      </form>
                    ) : (
                      <button type="button" className="flow-group-toggle" aria-expanded={!shut} onClick={() => toggleFold(key)}>
                        {g.name ?? "묶음 없음"} <span className="flow-group-count">{g.flows.length}</span>
                        {g.attention > 0 && <span className="pill bad"><IconAlert size={12} /> {g.attention}</span>}
                      </button>
                    )}
                    {canEdit && g.name !== null && !renaming && <button type="button" className="ghost small flow-group-edit" onClick={() => setRenaming({ from: key, to: key })}>이름 바꾸기</button>}
                  </div>
                  {!shut && <div className="card flow-rows">{g.flows.map((x) => row(x.flow, x.label))}</div>}
                </section>
              );
            })}
          </div>
        )}
      {hasFlows && <p className="flow-list-foot small muted">고른 줄을 묶음 머리로 끌어 옮길 수 있습니다 · <a href="#/templates">템플릿으로 새로 시작하기 →</a></p>}
      {canEdit && sel.size > 0 && (
        <div className="flow-bulk card" role="toolbar" aria-label="고른 워크플로우">
          <strong>{sel.size}개 고름</strong>
          <div className="flow-bulk-move">
            <button onClick={() => setMoving(!moving)} aria-expanded={moving}><IconFolder size={15} /> 묶음 옮기기</button>
            {moving && (
              <div className="menu flow-move-menu">
                {names.map((n) => <button key={n} className="menu-item" onClick={() => void move([...sel], n)}>{n}</button>)}
                <button className="menu-item muted" onClick={() => void move([...sel], null)}>묶음 없음</button>
                <form className="flow-move-new" onSubmit={(e) => { e.preventDefault(); if (newGroup.trim()) void move([...sel], newGroup); }}>
                  <input placeholder="새 묶음 이름" aria-label="새 묶음 이름" maxLength={40} value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
                  <button className="primary small" disabled={!newGroup.trim()}>옮기기</button>
                </form>
              </div>
            )}
          </div>
          <button className="danger" onClick={() => void removeMany([...sel])}><IconTrash size={15} /> 지우기</button>
          <span className="grow" />
          <button className="ghost" onClick={() => { setSel(new Set()); setMoving(false); }}>고르기 풀기</button>
        </div>
      )}
      </>}
    </div>
  );
}
