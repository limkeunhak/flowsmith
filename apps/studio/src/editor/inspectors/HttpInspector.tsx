/**
 * **HTTP 요청** 설정 — 무엇을(방법 · 주소) · 무엇과 함께(쿼리 · 헤더 · 본문) · 받은 것을 어떻게.
 * 시크릿은 헤더 · 쿼리 · 본문에만 — 「Authorization: Bearer {{ $secrets.apiKey }}」.
 */
import { useState } from "react";
import {
  HTTP_METHODS, httpSafe, isSingleRefTemplate, type Flow, type HttpBodyKind, type HttpConfig, type HttpMethod, type HttpNode, type HttpPair,
} from "@flowsmith/core";
import { suggestionsFor } from "../../model/index.ts";
import { Field, TemplateInput } from "../widgets.tsx";

type Update = (fn: (n: HttpNode) => HttpNode) => void;

const BODY_LABEL: Record<HttpBodyKind, string> = { none: "없음", json: "JSON", form: "폼(이름=값)", text: "글자" };

function Pairs({ flow, nodeId, pairs, onChange, secrets, namePlaceholder, add }: {
  flow: Flow; nodeId: string; pairs: HttpPair[]; onChange: (p: HttpPair[]) => void; secrets: boolean; namePlaceholder: string; add: string;
}) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      {pairs.map((p, i) => (
        <div key={i} className="row" style={{ alignItems: "flex-start" }}>
          <input className="mono" style={{ width: 150 }} value={p.name} placeholder={namePlaceholder} onChange={(e) => onChange(pairs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <div className="grow"><TemplateInput flow={flow} nodeId={nodeId} secrets={secrets} value={p.value} onChange={(v) => onChange(pairs.map((x, j) => (j === i ? { ...x, value: v } : x)))} /></div>
          <button className="small ghost" onClick={() => onChange(pairs.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="small" style={{ alignSelf: "flex-start" }} onClick={() => onChange([...pairs, { name: "", value: "" }])}>＋ {add}</button>
    </div>
  );
}

/** JSON 본문을 이름 – 값 표로 — 비었거나, 값이 모두 글자 · 숫자 · 참/거짓인 객체 하나일 때만. 아니면 null */
function flatPairs(text: string): HttpPair[] | null {
  if (text.trim() === "") return [];
  if (isSingleRefTemplate(text)) return null;
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const out: HttpPair[] = [];
  for (const [k, x] of Object.entries(v)) {
    if (x !== null && typeof x === "object") return null;
    out.push({ name: k, value: String(x ?? "") });
  }
  return out;
}

/** JSON 본문이 읽히나 — 검문소와 같은 규칙 */
function jsonProblem(text: string): string | null {
  if (text.trim() === "" || isSingleRefTemplate(text)) return null;
  try { JSON.parse(text); return null; } catch (e) { return (e as Error).message; }
}

export function HttpInspector({ flow, node, update }: { flow: Flow; node: HttpNode; update: Update }) {
  const c = node.config;
  const set = (patch: Partial<HttpConfig>) => update((n) => ({ ...n, config: { ...n.config, ...patch } }));
  const setBody = (patch: Partial<HttpConfig["body"]>) => set({ body: { ...c.body, ...patch } });
  const [chips, setChips] = useState(false);
  /** JSON 본문을 표 대신 글자 그대로 — 표로 나타낼 수 없는 JSON(겹친 객체 · 목록)은 언제나 이쪽 */
  const [jsonRaw, setJsonRaw] = useState(false);
  const safe = httpSafe(c.method);
  const bad = c.body.kind === "json" ? jsonProblem(c.body.text) : null;
  const firstSecret = flow.secrets.find((s) => s.kind === "text");

  return (
    <>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <Field label="방법">
          <select value={c.method} onChange={(e) => {
            const method = e.target.value as HttpMethod;
            set({ method, ...(httpSafe(method) ? { body: { ...c.body, kind: "none" } } : c.body.kind === "none" ? { body: { ...c.body, kind: "json" } } : {}) });
          }}>
            {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <div className="grow">
          <Field label="주소">
            <TemplateInput flow={flow} nodeId={node.id} value={c.url} placeholder="https://api.example.com/v1/items" onChange={(url) => set({ url })} />
          </Field>
        </div>
      </div>
      <span className="small muted">주소에는 시크릿을 쓰지 않습니다(기록에 남습니다) — API 키는 헤더나 쿼리 값에 넣으세요.</span>

      <h3>쿼리 — 주소 뒤 ?이름=값</h3>
      <Pairs flow={flow} nodeId={node.id} pairs={c.query} secrets onChange={(query) => set({ query })} namePlaceholder="page" add="쿼리" />

      <h3>헤더</h3>
      <Pairs flow={flow} nodeId={node.id} pairs={c.headers} secrets onChange={(headers) => set({ headers })} namePlaceholder="Authorization" add="헤더" />
      {!c.headers.some((h) => h.name.toLowerCase() === "authorization") && (
        <div className="chips">
          <span className="small muted">자주 쓰는 것:</span>
          <button className={firstSecret ? "secret" : ""} onClick={() => set({ headers: [...c.headers, { name: "Authorization", value: `Bearer {{ $secrets.${firstSecret?.name ?? "apiKey"} }}` }] })}>Authorization: Bearer 시크릿</button>
          <button onClick={() => set({ headers: [...c.headers, { name: "Accept", value: "application/json" }] })}>Accept: JSON</button>
        </div>
      )}
      {c.headers.some((h) => h.value.includes("$secrets")) && !firstSecret && (
        <span className="small" style={{ color: "var(--warn)" }}>워크플로우 설정에서 «글자 하나» 시크릿을 먼저 만드세요</span>
      )}

      {!safe && (
        <>
          <h3>본문</h3>
          <div className="row wrap">
            {(["json", "form", "text", "none"] as const).map((k) => (
              <label key={k} className="check"><input type="radio" checked={c.body.kind === k} onChange={() => setBody({ kind: k })} />{BODY_LABEL[k]}</label>
            ))}
          </div>
          {c.body.kind === "json" && flatPairs(c.body.text) !== null && (
            <div className="row">
              <label className="check"><input type="radio" checked={!jsonRaw} onChange={() => setJsonRaw(false)} />이름 – 값 표</label>
              <label className="check"><input type="radio" checked={jsonRaw} onChange={() => setJsonRaw(true)} />JSON 그대로(고급)</label>
            </div>
          )}
          {c.body.kind === "json" && !jsonRaw && flatPairs(c.body.text) !== null && (
            <>
              <Pairs flow={flow} nodeId={node.id} pairs={flatPairs(c.body.text)!} secrets namePlaceholder="title" add="칸"
                onChange={(p) => setBody({ text: p.length ? JSON.stringify(Object.fromEntries(p.map((x) => [x.name, x.value])), null, 2) : "" })} />
              <span className="small muted">이름과 값으로 JSON을 만들어 보냅니다. 값에 앞 단계의 목록을 고르면 목록 그대로 들어갑니다.</span>
            </>
          )}
          {(c.body.kind === "text" || (c.body.kind === "json" && (jsonRaw || flatPairs(c.body.text) === null))) && (
            <>
              <textarea className="mono" rows={7} value={c.body.text}
                placeholder={c.body.kind === "json" ? '{\n  "title": "{{ $input.title }}",\n  "rows": "{{ $input.rows }}"\n}' : "{{ $input.title }}"}
                onChange={(e) => setBody({ text: e.target.value })} />
              <div className="row">
                <button className="small" onClick={() => setChips(!chips)}>＋ 넣을 수 있는 값</button>
                {bad && <span className="small" style={{ color: "var(--bad)" }}>JSON을 읽을 수 없습니다 — {bad}</span>}
              </div>
              {chips && (
                <div className="chips">
                  {suggestionsFor(flow, node.id, true).map((s) => (
                    <button key={s.insert} className={s.secret ? "secret" : ""} onClick={() => { setBody({ text: c.body.text + (c.body.kind === "json" ? `"${s.insert}"` : s.insert) }); setChips(false); }}>{s.label}</button>
                  ))}
                </div>
              )}
              {c.body.kind === "json" && (
                <span className="small muted">
                  값은 따옴표 안에 씁니다 — <code>{'"{{ $input.title }}"'}</code>. 값 하나뿐인 글자는 그 값 그대로 들어갑니다(숫자 · 목록 · 객체).
                  본문 전체를 <code>{"{{ $input.rows }}"}</code> 하나로 써도 됩니다.
                </span>
              )}
            </>
          )}
          {c.body.kind === "form" && (
            <Pairs flow={flow} nodeId={node.id} pairs={c.body.fields} secrets onChange={(fields) => setBody({ fields })} namePlaceholder="name" add="칸" />
          )}
        </>
      )}

      <h3>받은 것</h3>
      <div className="row wrap">
        <span className="small muted">본문</span>
        <label className="check"><input type="radio" checked={c.response === "auto"} onChange={() => set({ response: "auto" })} />알아서(JSON이면 JSON)</label>
        <label className="check"><input type="radio" checked={c.response === "json"} onChange={() => set({ response: "json" })} />JSON</label>
        <label className="check"><input type="radio" checked={c.response === "text"} onChange={() => set({ response: "text" })} />글자</label>
      </div>
      <div className="row wrap">
        <span className="small muted">4xx · 5xx면</span>
        <label className="check"><input type="radio" checked={c.failOn === "status"} onChange={() => set({ failOn: "status" })} />노드 실패</label>
        <label className="check"><input type="radio" checked={c.failOn === "never"} onChange={() => set({ failOn: "never" })} />그대로 넘김(조건 노드로 status · ok를 나눕니다)</label>
      </div>
      <div className="row wrap">
        <Field label="시간 제한(ms) — 비우면 워크플로우 기본">
          <input type="number" min={100} style={{ width: 130 }} value={c.timeoutMs ?? ""} placeholder={String(flow.settings.defaultTimeoutMs)} onChange={(e) => set({ timeoutMs: e.target.value === "" ? null : Math.max(100, Number(e.target.value) || 100) })} />
        </Field>
        {safe && (
          <Field label="다시 해 보기(번) — 비우면 워크플로우 설정">
            <input type="number" min={0} max={5} style={{ width: 110 }} value={c.retries ?? ""} placeholder={String(flow.settings.retries)} onChange={(e) => set({ retries: e.target.value === "" ? null : Math.max(0, Math.min(5, Number(e.target.value) || 0)) })} />
          </Field>
        )}
      </div>
      <span className="small muted">
        내보내는 것: <code>status</code>(숫자) · <code>ok</code>(2xx면 참) · <code>body</code> · <code>headers</code>.
        {safe ? " 연결 실패 · 시간 초과 · 429 · 5xx면 다시 해 봅니다." : ` ★${c.method}는 다시 하지 않습니다 — 두 번 보내면 두 건이 될 수 있습니다. 변경 감시(점검)도 이 노드 앞에서 멈춥니다.`}
      </span>
    </>
  );
}
