/**
 * 첫 화면 — «무엇을 자동화할까요?»(템플릿) · 내 플로우 목록.
 * 목록은 고른 축으로 묶어 접고 편다 — 화면(서버가 주소로 알아낸 것 · 화면 규칙) · Suite · 묶지 않음. 살펴볼 것(문제 · 실패 · 사이트 바뀜)은 맨 위에(model/flowList.ts).
 * ★묶음을 사람이 워크플로우마다 적지 않는다 — 화면 규칙(주소 앞부분 → 이름)을 한 번 두면 새 워크플로우도 제자리에. 틀린 것만 골라 «화면 직접 지정».
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
import { areaNames, blankFlow, GROUP_BY_LABEL, groupFlows, matchesQuery, needsAttention, newFlowId, normPrefix, previewAreaCounts, redundantOverrides, SCHEDULE_CHOICES, sortFlows, SORT_LABEL, suggestAreas, suiteKeys, TEMPLATES, type FlowChoice, type FlowSort, type GroupBy, type Template } from "./model/index.ts";
import { IconAlert, IconBranch, IconCheck, IconChevronDown, IconCopy, IconFolder, IconPlay, IconPlus, IconSearch, IconTrash, IconX } from "./icons.tsx";
import type { AreaRule } from "@flowsmith/server/api-types";
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

/**
 * 화면 규칙 — 주소 앞부분 → 화면 이름. 고치는 동안 규칙마다 맞는 워크플로우 수를 미리 보인다.
 * 제안(호스트/첫 마디)을 눌러 채우고, 자동과 같아진 직접 지정은 풀 수 있다.
 */
function AreaRules({ flows, rules, onClose, onSaved, onClearRedundant }: { flows: FlowSummary[]; rules: AreaRule[]; onClose: () => void; onSaved: (r: AreaRule[]) => void; onClearRedundant: (ids: string[]) => Promise<void> }) {
  const [rows, setRows] = useState<AreaRule[]>(() => (rules.length ? rules : suggestAreas(flows, []).map(({ prefix, name }) => ({ prefix, name }))));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const counts = previewAreaCounts(flows, rows.map((r) => r.prefix));
  const more = suggestAreas(flows, rules).filter((x) => !rows.some((r) => normPrefix(r.prefix) === x.prefix));
  const redundant = redundantOverrides(flows);
  const bad = rows.some((r) => !normPrefix(r.prefix) || !r.name.trim());
  const set = (i: number, v: Partial<AreaRule>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...v } : r)));
  return (
    <div className="card stack area-rules">
      <div className="row"><h2 className="grow">화면 규칙</h2><button className="icon-btn" title="닫기" onClick={onClose}><IconX /></button></div>
      <div className="small muted">워크플로우가 여는 주소의 앞부분으로 화면을 정합니다 — 가장 긴 앞부분이 이깁니다. 예: <code>qa.msu.io</code> → MSU 웹, <code>qa.msu.io/navigator</code> → Navigator. 맞는 규칙이 없으면 호스트로 묶습니다.</div>
      {rows.length > 0 && (
        <div className="area-rule-rows">
          <div className="area-rule-row head small muted" aria-hidden="true"><span>주소 앞부분</span><span>화면 이름</span><span>맞는 것</span><span /></div>
          {rows.map((r, i) => (
            <div key={i} className="area-rule-row">
              <input aria-label="주소 앞부분" placeholder="qa.msu.io/navigator" value={r.prefix} onChange={(e) => set(i, { prefix: e.target.value })} />
              <input aria-label="화면 이름" placeholder="Navigator" maxLength={40} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
              <span className="small faint">{counts[i]}개</span>
              <button className="icon-btn" title="이 규칙 빼기" onClick={() => setRows(rows.filter((_, j) => j !== i))}><IconTrash size={15} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="row wrap small">
        <button className="ghost small" onClick={() => setRows([...rows, { prefix: "", name: "" }])}><IconPlus size={14} /> 규칙 더하기</button>
        {more.length > 0 && <span className="muted">제안:</span>}
        {more.slice(0, 6).map((x) => <button key={x.prefix} className="ghost small" onClick={() => setRows([...rows, { prefix: x.prefix, name: x.name }])}>{x.prefix} <span className="muted">{x.count}</span></button>)}
      </div>
      {redundant.length > 0 && (
        <div className="small muted row">직접 지정했지만 자동과 같은 것 {redundant.length}개 — 풀어 두면 주소가 바뀔 때 따라갑니다
          <button className="ghost small" disabled={busy} onClick={() => { setBusy(true); void onClearRedundant(redundant).finally(() => setBusy(false)); }}>지정 풀기</button>
        </div>
      )}
      {err && <div className="small" style={{ color: "var(--bad)" }}>{err}</div>}
      <div className="row"><span className="grow" />
        <button onClick={onClose}>그만두기</button>
        <button className="primary" disabled={bad || busy} onClick={() => {
          setBusy(true); setErr(null);
          api.setAreas(rows.map((r) => ({ prefix: r.prefix.trim(), name: r.name.trim() }))).then(onSaved, (e: Error) => setErr(e.message)).finally(() => setBusy(false));
        }}>저장</button>
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
const GROUP_BY_KEY = "flowsmith.flowList.groupBy";
const AREA_HINT_KEY = "flowsmith.flowList.areaHintOff";
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
  const [mode, setMode] = useState<"none" | "import" | "areas">("none");
  const [picked, setPicked] = useState<Template | null>(null);
  // 이 탭에서 목록을 떠날 때의 모습(찾기 · 거르기 · 스크롤) — 워크플로우를 열었다 돌아오면 그 자리로
  const back = useRef(readView());
  const [q, setQ] = useState(only === "templates" ? "" : back.current.q);
  const [json, setJson] = useState("");

  const load = () => api.listFlows().then(setFlows, (e: Error) => setError(e.message));
  // 화면 규칙 — 제안 · 직접 지정 메뉴 · 묶음 머리의 주소
  const [rules, setRules] = useState<AreaRule[]>([]);
  useEffect(() => { void load(); if (only !== "templates") void api.listAreas().then(setRules, () => {}); }, []);

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
  // 규칙에 없는 화면(호스트)은 뒤로 — 아직 정하지 않은 것
  const ruleNames = useMemo(() => new Set([...rules.map((r) => r.name), ...all.flatMap((f) => (f.group ? [f.group] : []))]), [rules, flows]);
  const [groupBy, setGroupBy] = useState<GroupBy>(() => readPref<GroupBy>(GROUP_BY_KEY, "area"));
  // Suite로 묶을 때만 받는다
  const [suites, setSuites] = useState<{ name: string; items: { flowId: string }[] }[] | null>(null);
  useEffect(() => { if (groupBy === "suite" && suites === null) void api.listSuites().then(setSuites, (e: Error) => setError(e.message)); }, [groupBy]);
  const groups = useMemo(() => (groupBy === "none" ? groupFlows(shown, () => []) : groupBy === "suite" ? groupFlows(shown, suiteKeys(suites ?? [])) : groupFlows(shown, undefined, (n) => !ruleNames.has(n))), [shown, groupBy, suites, ruleNames]);
  const searching = q.trim() !== "";
  // 살펴볼 것 — 많을 때(묶음을 접어 둘 때) · 거르지도 찾지도 않을 때만 맨 위에(묶음 안에도 그대로 있다). 적으면 한눈에 보인다
  const attention = all.length > FOLD_OVER && only2 === "all" && !searching ? shown.filter(needsAttention) : [];
  // 접은 것은 축마다 따로(«화면:Navigator» · «Suite:…»)
  const foldKey = (g: string | null) => `${groupBy}:${g ?? ""}`;
  const shutOf = (g: string | null) => folded[foldKey(g)] ?? all.length > FOLD_OVER;
  const toggleFold = (g: string | null) => setFolded((v) => { const k = foldKey(g); const next = { ...v, [k]: !(v[k] ?? all.length > FOLD_OVER) }; writePref(FOLD_KEY, next); return next; });
  const open = (m: typeof mode) => { setPicked(null); setMode(mode === m ? "none" : m); };

  // ── 여럿 고르기 · 화면 직접 지정 ──
  const canEdit = me.can("editor");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [newGroup, setNewGroup] = useState("");
  const [hintOff, setHintOff] = useState(() => readPref<boolean>(AREA_HINT_KEY, false));
  const names = useMemo(() => areaNames(all, rules), [flows, rules]);
  // 화면 규칙이 아직 없으면 — 주소로 나눌 수 있다고 한 번 알린다
  const hint = useMemo(() => (canEdit && !hintOff && rules.length === 0 && groupBy === "area" ? suggestAreas(all, []) : []), [flows, rules, canEdit, hintOff, groupBy]);
  const prefixesOf = (name: string) => rules.filter((r) => r.name === name).map((r) => r.prefix);
  const pick = (ids: string[], on: boolean) => setSel((v) => { const n = new Set(v); for (const id of ids) on ? n.add(id) : n.delete(id); return n; });
  // 지워졌거나 걸러져 안 보이는 것은 고른 데서 뺀다 — 보이지 않는 것을 옮기거나 지우지 않게
  useEffect(() => { setSel((v) => { const seen = new Set(shown.map((f) => f.id)); const n = new Set([...v].filter((id) => seen.has(id))); return n.size === v.size ? v : n; }); }, [shown]);

  /** 화면 직접 지정(null이면 자동으로) — 목록을 다시 받지 않고 그 자리에서 바꾼다(고친 때도 그대로라 차례가 흔들리지 않는다) */
  async function move(ids: string[], group: string | null) {
    if (ids.length === 0) return;
    setError(null);
    try {
      const r = await api.setFlowGroup(ids, group);
      const moved = (all.filter((f) => ids.includes(f.id)).map((f) => ({ ...f, group: r.group })));
      setFlows((fs) => (fs ?? []).map((f) => (ids.includes(f.id) ? { ...f, group: r.group } : f)));
      // 간 곳이 접혀 있으면 편다 — 어디로 갔는지 보이게
      const to = new Set(moved.map((f) => f.group ?? f.area));
      setFolded((v) => { const next = { ...v }; for (const g of to) next[`area:${g ?? ""}`] = false; writePref(FOLD_KEY, next); return next; });
      setNote(r.group ? `${ids.length}개의 화면을 «${r.group}»(으)로 직접 지정했습니다` : `${ids.length}개를 주소로 알아낸 화면으로 되돌렸습니다`);
      setSel(new Set()); setMoving(false); setNewGroup("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function removeMany(ids: string[]) {
    if (!confirm(`고른 워크플로우 ${ids.length}개를 지울까요? 버전 · 시크릿 · 실행 기록도 함께 지워집니다.`)) return;
    for (const id of ids) await api.deleteFlow(id).catch((e: Error) => setError(e.message));
    setSel(new Set());
    void load();
  }
  /** 화면 규칙을 저장했다 — 서버가 주소로 다시 묶은 목록을 받는다 */
  const rulesSaved = (r: AreaRule[]) => { setRules(r); setMode("none"); setNote(`화면 규칙 ${r.length}개를 저장했습니다`); void load(); };
  async function clearRedundant(ids: string[]) {
    await api.setFlowGroup(ids, null).then(() => { setNote(`자동과 같은 직접 지정 ${ids.length}개를 풀었습니다`); return load(); }, (e: Error) => setError(e.message));
  }

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
      onClick={() => { location.hash = `#/flows/${encodeURIComponent(f.id)}`; }}
      onKeyDown={(e) => { if (e.key === "Enter") location.hash = `#/flows/${encodeURIComponent(f.id)}`; }}>
      <div className="flow-cell-pick" onClick={(e) => e.stopPropagation()}>
        {canEdit && <input type="checkbox" aria-label={`${f.name} 고르기`} checked={sel.has(f.id)} onChange={(e) => pick([f.id], e.target.checked)} />}
      </div>
      <div className="flow-cell-name">
        <div className="name" title={f.site ? `${f.name}\n${f.site}` : f.name}><span className="flow-label">{label}</span>
          {f.group !== null && f.group !== f.area && <span className="pill flow-pinned" title={`직접 지정한 화면 — 주소로는 «${f.area ?? "모름"}»`}>직접 지정</span>}
          {me.auth && <span className={`pill team-pill${f.team ? "" : " shared"}`}>{f.team?.name ?? "공용"}</span>}</div>
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
        {only !== "templates" && canEdit && <button onClick={() => open("areas")}>화면 규칙</button>}
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

      {mode === "areas" && flows !== null && <AreaRules flows={all} rules={rules} onClose={() => setMode("none")} onSaved={rulesSaved} onClearRedundant={clearRedundant} />}

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
          <label className="flow-sort small muted">묶어 보기
            <select value={groupBy} onChange={(e) => { const v = e.target.value as GroupBy; setGroupBy(v); writePref(GROUP_BY_KEY, v); setSel(new Set()); }}>
              {(Object.keys(GROUP_BY_LABEL) as GroupBy[]).map((k) => <option key={k} value={k}>{GROUP_BY_LABEL[k]}</option>)}
            </select>
          </label>
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
            {hint.length > 0 && mode !== "areas" && (
              <div className="banner info flow-suggest">
                <IconFolder size={16} />
                <span className="grow">주소로 화면을 나눌 수 있습니다 — {hint.slice(0, 4).map((x) => `${x.prefix} ${x.count}`).join(" · ")}{hint.length > 4 ? ` 외 ${hint.length - 4}` : ""}. 화면 규칙을 정하면 새 워크플로우도 알아서 제자리에 들어갑니다.</span>
                <button className="primary small" onClick={() => open("areas")}>화면 규칙 정하기</button>
                <button className="ghost small" onClick={() => { setHintOff(true); writePref(AREA_HINT_KEY, true); }}>그만두기</button>
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
              // 묶지 않거나 묶음이 하나도 없으면 머리 없이 한 장으로
              if (g.name === null && groups.length === 1) return <div key="all" className="card flow-rows">{g.flows.map((x) => row(x.flow, x.label))}</div>;
              const key = g.name ?? "";
              const shut = !searching && shutOf(g.name);
              const ids = g.flows.map((x) => x.flow.id);
              const allOn = ids.every((id) => sel.has(id));
              const label = g.name ?? (groupBy === "suite" ? "Suite에 없음" : "화면 모름");
              const sites = groupBy === "area" && g.name ? prefixesOf(g.name) : [];
              return (
                <section key={key} className="flow-group">
                  {/* 머리의 칸은 줄과 같다 — 접기(왼쪽 여백) · 고르기 칸 · 이름(줄의 이름과 같은 자리에서 시작) */}
                  <div className="flow-group-head">
                    <button type="button" className="flow-group-fold" aria-label={shut ? "펴기" : "접기"} aria-expanded={!shut} onClick={() => toggleFold(g.name)}><IconChevronDown size={14} className={shut ? "fold shut" : "fold"} /></button>
                    <span className="flow-group-slot">{canEdit && <input type="checkbox" className="flow-group-pick" aria-label={`${label} 모두 고르기`} checked={allOn} onChange={(e) => pick(ids, e.target.checked)} />}</span>
                    <button type="button" className="flow-group-toggle" aria-expanded={!shut} onClick={() => toggleFold(g.name)}>
                      {label} <span className="flow-group-count">{g.flows.length}</span>
                      {g.attention > 0 && <span className="pill bad"><IconAlert size={12} /> {g.attention}</span>}
                    </button>
                    {sites.length > 0 && <span className="flow-group-site small faint" title="이 화면의 주소 앞부분 — 화면 규칙">{sites.join(" · ")}</span>}
                  </div>
                  {!shut && <div className="card flow-rows">{g.flows.map((x) => row(x.flow, x.label))}</div>}
                </section>
              );
            })}
          </div>
        )}
      {hasFlows && <p className="flow-list-foot small muted">화면은 주소로 알아서 묶입니다 — 틀린 것만 골라 직접 지정하세요 · <a href="#/templates">템플릿으로 새로 시작하기 →</a></p>}
      {canEdit && sel.size > 0 && (
        <div className="flow-bulk card" role="toolbar" aria-label="고른 워크플로우">
          <strong>{sel.size}개 고름</strong>
          {groupBy === "area" && (
            <div className="flow-bulk-move">
              <button onClick={() => setMoving(!moving)} aria-expanded={moving}><IconFolder size={15} /> 화면 직접 지정</button>
              {moving && (
                <div className="menu flow-move-menu">
                  {names.map((n) => <button key={n} className="menu-item" onClick={() => void move([...sel], n)}>{n}</button>)}
                  <button className="menu-item muted" onClick={() => void move([...sel], null)}>주소로 자동(지정 풀기)</button>
                  <form className="flow-move-new" onSubmit={(e) => { e.preventDefault(); if (newGroup.trim()) void move([...sel], newGroup); }}>
                    <input placeholder="새 화면 이름" aria-label="새 화면 이름" maxLength={40} value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
                    <button className="primary small" disabled={!newGroup.trim()}>지정</button>
                  </form>
                </div>
              )}
            </div>
          )}
          <button className="danger" onClick={() => void removeMany([...sel])}><IconTrash size={15} /> 지우기</button>
          <span className="grow" />
          <button className="ghost" onClick={() => { setSel(new Set()); setMoving(false); }}>고르기 풀기</button>
        </div>
      )}
      </>}
    </div>
  );
}
