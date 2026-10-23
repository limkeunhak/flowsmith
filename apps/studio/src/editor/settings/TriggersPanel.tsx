/**
 * **트리거** — 일정(cron) · 웹훅 (PLAN §8 M6) · 다른 플로우가 끝나면 · 파일이 생기면(ChainTriggers.tsx, PLAN §37).
 *
 * 일정은 플로우 설정(매니페스트)에 들어간다 — 버전과 함께 간다. ★게시된 버전의 일정만 돈다.
 * 웹훅 토큰은 서버에만 있다(해시) — 만들 때 한 번만 보인다.
 */
import { useEffect, useState } from "react";
import { describeCron, nextFires, type Flow, type Schedule } from "@flowsmith/core";
import { api, ApiError } from "../../api.ts";
import { nextId } from "../../model/index.ts";
import { IconClock, IconCopy, IconX } from "../../icons.tsx";
import { Field } from "../widgets.tsx";
import { AfterSection, FileSection } from "./ChainTriggers.tsx";
import { dateTimeDay } from "../../format.ts";

const PRESETS: { label: string; cron: string }[] = [
  { label: "평일 9시", cron: "0 9 * * 1-5" },
  { label: "매일 18시", cron: "0 18 * * *" },
  { label: "매시 정각", cron: "0 * * * *" },
  { label: "30분마다", cron: "*/30 * * * *" },
];

function preview(cron: string): { ok: true; text: string; next: Date[] } | { ok: false; error: string } {
  try { return { ok: true, text: describeCron(cron), next: nextFires(cron, new Date(), 3) }; }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}

export function TriggersPanel({ flow, activeVersion, update, onClose, onToast }: {
  flow: Flow; activeVersion: number | null; update: (fn: (f: Flow) => Flow) => void; onClose: () => void; onToast: (t: string) => void;
}) {
  const schedules = flow.settings.schedules;
  const setSchedules = (fn: (s: Schedule[]) => Schedule[]) => update((f) => ({ ...f, settings: { ...f.settings, schedules: fn(f.settings.schedules) } }));
  const setOne = (id: string, patch: Partial<Schedule>) => setSchedules((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  return (
    <div className="drawer-inner">
      <div className="drawer-head"><IconClock /><h2 className="grow">트리거</h2><button className="icon-btn" onClick={onClose}><IconX /></button></div>
      <div className="drawer-body stack">
        <div className="small muted">
          트리거는 <b>게시된 버전</b>을 돌립니다{activeVersion !== null ? ` — 지금 v${activeVersion}` : " — 아직 게시하지 않았습니다"}. 일정을 고친 뒤에는 새 버전으로 게시해야 바뀝니다.
        </div>
        {flow.settings.browser === "attach" && (
          <div className="banner warn small">사람의 크롬에 붙는 워크플로우입니다 — 정해진 시각에 그 크롬이 켜져 있고 사이트에 로그인돼 있어야 돕니다.</div>
        )}

        <h3>일정</h3>
        {schedules.length === 0 && <div className="small muted">아직 일정이 없습니다</div>}
        {schedules.map((s) => {
          const p = preview(s.cron);
          return (
            <div key={s.id} className="subcard">
              <div className="row">
                <label className="check"><input type="checkbox" checked={s.enabled} onChange={(e) => setOne(s.id, { enabled: e.target.checked })} />켬</label>
                <input className="mono grow" value={s.cron} aria-label="cron" onChange={(e) => setOne(s.id, { cron: e.target.value })} />
                <button className="icon-btn" title="일정 지우기" onClick={() => setSchedules((ss) => ss.filter((x) => x.id !== s.id))}><IconX size={14} /></button>
              </div>
              <div className="chips">{PRESETS.map((x) => <button key={x.cron} onClick={() => setOne(s.id, { cron: x.cron })}>{x.label}</button>)}</div>
              {p.ok
                ? <div className="small"><b>{p.text}</b> <span className="muted">· 다음: {p.next.map((d) => dateTimeDay(d)).join(" · ")}</span></div>
                : <div className="small" style={{ color: "var(--bad)" }}>{p.error}</div>}
              {flow.params.map((param) => (
                <Field key={param.name} label={`${param.label || param.name}${param.required ? " *" : ""}`}>
                  <input value={s.params[param.name] ?? ""} onChange={(e) => setOne(s.id, { params: { ...s.params, [param.name]: e.target.value } })} />
                </Field>
              ))}
            </div>
          );
        })}
        <button onClick={() => setSchedules((ss) => [...ss, { id: nextId("s", ss.map((x) => x.id)), cron: "0 9 * * 1-5", params: { ...flow.settings.probeParams }, enabled: true }])}>＋ 일정 더하기</button>
        <span className="small muted">분 시 일 월 요일 · 서버의 시각(한국 시간) · 서버가 꺼져 있던 동안 지난 일정은 다시 돌리지 않습니다 · 앞 실행이 돌고 있으면 그 차례는 건너뜁니다</span>

        <h3>다른 워크플로우가 끝나면</h3>
        <AfterSection flow={flow} update={update} />

        <h3>파일이 생기면</h3>
        <FileSection flow={flow} update={update} />

        <h3>웹훅</h3>
        <WebhookSection flow={flow} onToast={onToast} />
      </div>
    </div>
  );
}

function WebhookSection({ flow, onToast }: { flow: Flow; onToast: (t: string) => void }) {
  const [state, setState] = useState<{ enabled: boolean; createdAt: string | null; path: string } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const reload = () => api.getWebhook(flow.id).then(setState, () => undefined);
  useEffect(() => { void reload(); }, [flow.id]);

  const issue = async () => {
    if (state?.enabled && !confirm("토큰을 새로 만들면 지금 토큰은 바로 쓸 수 없게 됩니다. 계속할까요?")) return;
    try { const r = await api.enableWebhook(flow.id); setToken(r.token); void reload(); }
    catch (e) { onToast(e instanceof ApiError ? e.message : String(e)); }
  };
  const off = async () => {
    if (!confirm("웹훅을 끌까요? 이 주소로 오는 요청은 더 이상 돌지 않습니다.")) return;
    await api.disableWebhook(flow.id).catch(() => undefined);
    setToken(null);
    void reload();
  };
  const url = state ? `${location.origin}${state.path}` : "";
  const body = JSON.stringify(Object.fromEntries(flow.params.map((p) => [p.name, flow.settings.probeParams[p.name] ?? ""])));
  const curl = `curl -X POST '${url}?wait=1' \\\n  -H 'x-flowsmith-token: ${token ?? "<토큰>"}' \\\n  -H 'content-type: application/json' \\\n  -d '${body}'`;
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => onToast("복사했습니다"), () => undefined);

  if (!state) return <div className="small muted">불러오는 중…</div>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        {state.enabled ? <span className="pill ok">켜짐 · {new Date(state.createdAt!).toLocaleString("ko-KR")}</span> : <span className="pill">꺼짐</span>}
        <span className="grow" />
        <button className="small" onClick={() => void issue()}>{state.enabled ? "토큰 새로 만들기" : "웹훅 켜기"}</button>
        {state.enabled && <button className="small danger" onClick={() => void off()}>끄기</button>}
      </div>
      {token && (
        <div className="banner warn small stack" style={{ gap: 6 }}>
          <b>이 토큰은 지금만 보입니다 — 안전한 곳에 적어 두세요</b>
          <div className="row"><code className="grow token">{token}</code><button className="icon-btn" title="복사" onClick={() => void copy(token)}><IconCopy /></button></div>
        </div>
      )}
      {state.enabled && (
        <>
          <Field label="주소"><div className="row"><code className="grow token">{url}</code><button className="icon-btn" title="복사" onClick={() => void copy(url)}><IconCopy /></button></div></Field>
          <span className="small muted">본문(JSON)의 값이 실행 입력이 됩니다. 정의된 입력만 받습니다. <code>?wait=1</code>이면 끝날 때까지 기다려 결과를 돌려줍니다(최대 2분).</span>
          <pre className="json">{curl}</pre>
        </>
      )}
    </div>
  );
}
