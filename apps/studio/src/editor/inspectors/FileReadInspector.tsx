/**
 * **파일 읽기 노드** 설정 — 어느 폴더의 · 어느 파일을 · 어떻게.
 * 가장 쉬운 길: 그 파일을 쓰는 «파일 쓰기» 노드를 고르면 폴더 · 이름 · 형식 · 롤링이 그대로 맞춰진다.
 */
import { useEffect, useState } from "react";
import {
  belongsTo, describePick, latestOf, readFileName,
  type FileReadNode, type FileReadSource, type FileStoreTarget, type FileWriteNode, type Flow, type ReadPick, type StoreFormat, type TimeUnit,
} from "@flowsmith/core";
import { api, ApiError, type FileEntry, type FlowSummary } from "../../api.ts";
import { withStoreDefaults } from "@flowsmith/core";
import { Field } from "../widgets.tsx";

type Update = (fn: (n: FileReadNode) => FileReadNode) => void;

const FORMATS: { id: StoreFormat; label: string }[] = [
  { id: "csv", label: "CSV" }, { id: "jsonl", label: "JSON Lines" }, { id: "json", label: "JSON 배열" }, { id: "text", label: "텍스트" },
];
const UNITS: { id: TimeUnit; label: string }[] = [{ id: "day", label: "날" }, { id: "hour", label: "시간" }, { id: "month", label: "달" }];

/** 쓰는 쪽의 롤링 → 읽는 쪽의 «어느 파일» */
function pickFor(t: FileStoreTarget): ReadPick {
  if (t.rolling.kind === "time") return { kind: "time", unit: t.rolling.unit, offset: 0 };
  if (t.rolling.kind === "sequence") return { kind: "latest" };
  return { kind: "fixed" };
}

export function FileReadInspector({ flow, node, update }: { flow: Flow; node: FileReadNode; update: Update }) {
  const s = node.config.source;
  const setS = (patch: Partial<FileReadSource>) => update((n) => ({ ...n, config: { ...n.config, source: { ...n.config.source, ...patch } } }));
  const set = (patch: Partial<FileReadNode["config"]>) => update((n) => ({ ...n, config: { ...n.config, ...patch } }));
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  useEffect(() => { void api.listFlows().then(setFlows, () => undefined); }, []);
  const now = new Date();
  const fixedName = readFileName(s, now);
  const where = s.scope === "otherFlow" ? `워크플로우 「${flows.find((f) => f.id === s.flowId)?.name ?? s.flowId ?? "?"}」의 폴더` : s.scope === "shared" ? "공유 폴더" : "이 워크플로우 폴더";

  return (
    <>
      <FromWriter flow={flow} flows={flows} onPick={(src) => setS(src)} />

      <h3>어디서</h3>
      <div className="row wrap">
        <label className="check"><input type="radio" checked={s.scope === "otherFlow"} onChange={() => setS({ scope: "otherFlow" })} />다른 워크플로우의 폴더</label>
        <label className="check"><input type="radio" checked={s.scope === "shared"} onChange={() => setS({ scope: "shared", flowId: null })} />공유 폴더</label>
        <label className="check"><input type="radio" checked={s.scope === "flow"} onChange={() => setS({ scope: "flow", flowId: null })} />이 워크플로우 폴더</label>
      </div>
      {s.scope === "otherFlow" && (
        <Field label="워크플로우">
          <select value={s.flowId ?? ""} onChange={(e) => setS({ flowId: e.target.value || null })}>
            <option value="">(고르세요)</option>
            {flows.filter((f) => f.id !== flow.id).map((f) => <option key={f.id} value={f.id}>{f.name} ({f.id})</option>)}
          </select>
        </Field>
      )}
      <div className="row">
        <Field label="하위 폴더(비워도 됨)"><input className="mono" value={s.dir} placeholder="(바로 아래)" onChange={(e) => setS({ dir: e.target.value.trim() })} /></Field>
        <Field label="파일 이름"><input className="mono" value={s.name} onChange={(e) => setS({ name: e.target.value })} /></Field>
      </div>
      <div className="chips">
        {FORMATS.map((f) => <button key={f.id} className={s.format === f.id ? "on" : ""} onClick={() => setS({ format: f.id })}>{f.label}</button>)}
      </div>

      <h3>어느 파일</h3>
      <div className="row wrap">
        <label className="check"><input type="radio" checked={s.pick.kind === "latest"} onChange={() => setS({ pick: { kind: "latest" } })} />가장 최근 파일</label>
        <label className="check"><input type="radio" checked={s.pick.kind === "time"} onChange={() => setS({ pick: { kind: "time", unit: "day", offset: 0 } })} />날짜로</label>
        <label className="check"><input type="radio" checked={s.pick.kind === "fixed"} onChange={() => setS({ pick: { kind: "fixed" } })} />이름 그대로</label>
      </div>
      {s.pick.kind === "time" && (() => {
        const p = s.pick;
        return (
          <div className="row">
            <select style={{ width: 110 }} value={p.offset === 0 ? "0" : p.offset === -1 ? "-1" : "n"} onChange={(e) => setS({ pick: { ...p, offset: e.target.value === "0" ? 0 : e.target.value === "-1" ? -1 : -2 } })}>
              <option value="0">이번</option><option value="-1">지난</option><option value="n">몇 … 전</option>
            </select>
            {p.offset < -1 && <input type="number" min={2} max={366} style={{ width: 70 }} value={-p.offset} onChange={(e) => setS({ pick: { ...p, offset: -Math.max(2, Math.min(366, Number(e.target.value) || 2)) } })} />}
            <select style={{ width: 90 }} value={p.unit} onChange={(e) => setS({ pick: { ...p, unit: e.target.value as TimeUnit } })}>
              {UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
            <span className="small muted grow">— {describePick(p)}</span>
          </div>
        );
      })()}
      <div className="name-preview">
        {fixedName ? `지금 실행하면 → [${where}]/${s.dir ? `${s.dir}/` : ""}${fixedName}` : `[${where}]/${s.dir ? `${s.dir}/` : ""}${s.name}-… 중 가장 최근 것(날짜 · 번호가 가장 큰 것)`}
      </div>

      <h3>읽는 법</h3>
      {s.format === "csv" && <label className="check"><input type="checkbox" checked={s.csv.header} onChange={(e) => setS({ csv: { header: e.target.checked } })} />첫 줄이 열 이름 — 아니면 열1 · 열2 …</label>}
      <div className="row wrap">
        <span className="small muted">파일이 없으면</span>
        <label className="check"><input type="radio" checked={node.config.missing === "fail"} onChange={() => set({ missing: "fail" })} />멈춤</label>
        <label className="check"><input type="radio" checked={node.config.missing === "empty"} onChange={() => set({ missing: "empty" })} />빈 목록으로 계속</label>
      </div>
      <Field label="최대 줄 수(비우면 다)">
        <input type="number" min={1} style={{ width: 120 }} value={node.config.maxRows ?? ""} onChange={(e) => set({ maxRows: e.target.value === "" ? null : Math.max(1, Number(e.target.value)) })} />
      </Field>
      <span className="small muted">내보내는 것: <code>rows</code>(줄들 — 뒤의 «다른 워크플로우 실행»이 행마다 돌릴 수 있다) · <code>file</code> · <code>count</code></span>

      <FolderFiles flowId={s.scope === "otherFlow" ? s.flowId : flow.id} source={s} />
    </>
  );
}

/** 그 파일을 쓰는 «파일 쓰기» 노드를 골라 설정을 맞춘다 */
function FromWriter({ flow, flows, onPick }: { flow: Flow; flows: FlowSummary[]; onPick: (s: Partial<FileReadSource>) => void }) {
  const [from, setFrom] = useState("");
  const [writers, setWriters] = useState<FileWriteNode[] | null>(null);
  useEffect(() => {
    if (!from) { setWriters(null); return; }
    if (from === flow.id) { setWriters(flow.nodes.filter((n): n is FileWriteNode => n.type === "fileWrite")); return; }
    void api.getFlow(from).then((d) => setWriters((d.draft.nodes ?? []).filter((n) => n.type === "fileWrite" || (n.type as string) === "store")
      .map((n) => ({ ...(n as FileWriteNode), type: "fileWrite" as const, config: withStoreDefaults((n as FileWriteNode).config) }))), () => setWriters([]));
  }, [from]);
  return (
    <div className="subcard">
      <strong>파일 쓰기 노드에서 가져오기</strong>
      <span className="small muted">그 파일을 쓰는 노드를 고르면 폴더 · 이름 · 형식 · 롤링을 맞춥니다</span>
      <select value={from} onChange={(e) => setFrom(e.target.value)}>
        <option value="">(워크플로우 고르기)</option>
        {flows.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.id}){f.id === flow.id ? " — 이 워크플로우" : ""}</option>)}
      </select>
      {writers?.length === 0 && <span className="small muted">이 워크플로우에는 파일 쓰기 노드가 없습니다</span>}
      <div className="chips">
        {writers?.map((w) => {
          const t = w.config.target;
          return (
            <button key={w.id} onClick={() => onPick({
              scope: t.scope === "shared" ? "shared" : from === flow.id ? "flow" : "otherFlow",
              flowId: t.scope === "shared" || from === flow.id ? null : from,
              dir: t.dir, name: t.name, format: t.format, pick: pickFor(t), csv: { header: t.csv.header },
            })}>「{w.name}」 · {t.scope === "shared" ? "공유/" : ""}{t.name}.{t.format === "text" ? "txt" : t.format}</button>
          );
        })}
      </div>
    </div>
  );
}

/** 그 폴더의 파일들 — 읽을 파일에 표시 */
function FolderFiles({ flowId, source: s }: { flowId: string | null; source: FileReadSource }) {
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => {
    if (s.scope === "otherFlow" && !flowId) { setFiles(null); return; }
    api.listStoreFiles(flowId ?? "", s.scope === "shared" ? "shared" : "flow", s.dir)
      .then((r) => { setError(null); setFiles(r.entries.filter((e) => e.kind === "file" && belongsTo({ name: s.name, format: s.format } as FileStoreTarget, e.name))); },
        (e) => setError(e instanceof ApiError ? e.message : String(e)));
  };
  useEffect(reload, [flowId, s.scope, s.dir, s.name, s.format]);
  const target = files ? (readFileName(s, new Date()) ?? latestOf(s, files.map((f) => f.name))) : null;
  return (
    <>
      <div className="row"><h3 className="grow">그 폴더의 파일</h3><button className="small ghost" onClick={reload}>새로고침</button></div>
      {error && <div className="small muted">{error}</div>}
      {files?.length === 0 && <div className="small muted">아직 없습니다 — 그 파일을 쓰는 워크플로우가 돌면 생깁니다</div>}
      {files && files.length > 0 && target && !files.some((f) => f.name === target) && (
        <div className="banner warn small">읽을 파일 {target}이(가) 아직 없습니다 — 지금 돌리면 {"«파일이 없으면»"} 설정대로 됩니다</div>
      )}
      <div className="file-list">
        {files?.slice(0, 20).map((f) => (
          <div key={f.path} className="file-row">
            <span className="fname">{f.name}</span>
            {f.name === target && <span className="pill accent">읽을 파일</span>}
            <span className="fmeta">{(f.size / 1024).toFixed(1)}KB · {new Date(f.modified).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            {api.canXlsx(f.name) && <a className="small xlsx-btn" title="엑셀(.xlsx)로 바꿔 받기" href={api.xlsxUrl(f.path)}>엑셀</a>}
            <a className="small" href={api.downloadUrl(f.path)}>받기</a>
          </div>
        ))}
      </div>
    </>
  );
}
