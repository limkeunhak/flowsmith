/**
 * **파일 쓰기 노드** 설정 — 무엇을 · 어느 파일에 · 어떻게(이어 붙이기 · 덮어쓰기) · 언제 새 파일로(롤링).
 * 이름 짓기는 엔진과 같은 함수(core의 fileNameFor)로 미리 보여 준다. 아래에는 이 노드가 쓴 파일들.
 */
import { useEffect, useState } from "react";
import {
  badDir, badFileName, belongsTo, describeRolling, fileNameFor,
  type Flow, type FileStoreTarget, type Rolling, type StoreFormat, type FileWriteNode,
} from "@flowsmith/core";
import { api, ApiError, type FileEntry } from "../../api.ts";
import { IconDownload, IconTrash, IconX } from "../../icons.tsx";
import { Field, TemplateInput } from "../widgets.tsx";
import { dateTime } from "../../format.ts";

type Update = (fn: (n: FileWriteNode) => FileWriteNode) => void;

const FORMATS: { id: StoreFormat; label: string; hint: string }[] = [
  { id: "csv", label: "CSV", hint: "엑셀로 엽니다 — 목록의 항목마다 한 줄, 값의 이름이 열" },
  { id: "jsonl", label: "JSON Lines", hint: "한 줄에 하나(JSON) — 이어 붙이기 좋고 다른 프로그램이 읽기 좋습니다" },
  { id: "json", label: "JSON 배열", hint: "파일 전체가 배열 하나 — 이어 붙이면 파일을 다시 씁니다" },
  { id: "text", label: "텍스트", hint: "한 줄에 하나 — 글자는 그대로, 여러 값이면 탭으로 나눕니다" },
];

/** 롤링 고르기 — 시간과 번호를 한 목록에 */
const ROLL_CHOICES: { id: string; label: (name: string) => string; make: (limit: number | null) => Rolling }[] = [
  { id: "none", label: () => "롤링 없음 — 늘 같은 파일", make: () => ({ kind: "none" }) },
  { id: "time:day", label: (n) => `날마다 새 파일 (${n}-20261015)`, make: () => ({ kind: "time", unit: "day" }) },
  { id: "time:hour", label: (n) => `시간마다 새 파일 (${n}-20261015-09)`, make: () => ({ kind: "time", unit: "hour" }) },
  { id: "time:month", label: (n) => `달마다 새 파일 (${n}-202610)`, make: () => ({ kind: "time", unit: "month" }) },
  { id: "seq:run", label: (n) => `실행마다 새 번호 (${n}-0001, 0002…)`, make: () => ({ kind: "sequence", every: "run", limit: null }) },
  { id: "seq:rows", label: () => "행이 차면 새 번호", make: (l) => ({ kind: "sequence", every: "rows", limit: l ?? 10000 }) },
  { id: "seq:bytes", label: () => "크기가 차면 새 번호", make: (l) => ({ kind: "sequence", every: "bytes", limit: l ?? 10 * 1024 * 1024 }) },
];
const rollId = (r: Rolling) => (r.kind === "none" ? "none" : r.kind === "time" ? `time:${r.unit}` : `seq:${r.every}`);

const size = (n: number) => (n < 1024 ? `${n}B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);

export function FileWriteInspector({ flow, node, update }: { flow: Flow; node: FileWriteNode; update: Update }) {
  const t = node.config.target;
  const setT = (patch: Partial<FileStoreTarget>) => update((n) => ({ ...n, config: { ...n.config, target: { ...n.config.target, ...patch } } }));
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 3600_000);
  const dirProblem = badDir(t.dir);
  const nameProblem = badFileName(t.name);
  const base = t.scope === "shared" ? "공유 폴더" : "이 워크플로우 폴더";
  const path = (name: string) => `[${base}]/${t.dir ? `${t.dir}/` : ""}${name}`;
  // ★같은 플로우 안에서 같은 파일을 가리키는 파일 쓰기 노드 — 갈래마다 같은 파일에 쓰는 건 괜찮지만, 대개는 실수다
  const twins = flow.nodes.filter((n): n is FileWriteNode => n.type === "fileWrite" && n.id !== node.id).filter((n) => {
    const o = n.config.target;
    return o && o.scope === t.scope && o.dir === t.dir && o.name === t.name && o.format === t.format;
  });

  return (
    <>
      <Field label="저장할 값" hint="앞 노드가 내놓은 것 — 목록이면 항목마다 한 줄, 값 하나면 한 줄">
        <TemplateInput flow={flow} nodeId={node.id} value={node.config.data} placeholder="{{ $input.news }}"
          onChange={(data) => update((n) => ({ ...n, config: { ...n.config, data } }))} />
      </Field>

      <h3>파일</h3>
      <div className="row">
        <label className="check"><input type="radio" checked={t.scope === "flow"} onChange={() => setT({ scope: "flow" })} />이 워크플로우 폴더</label>
        <label className="check"><input type="radio" checked={t.scope === "shared"} onChange={() => setT({ scope: "shared" })} />공유 폴더</label>
      </div>
      <span className="small muted">
        {t.scope === "flow"
          ? "워크플로우마다 따로 있는 폴더입니다 — 다른 워크플로우(복사해 만든 것도)와 섞이지 않습니다"
          : "여러 워크플로우가 함께 쓰는 폴더(files/shared)입니다 — 같은 이름이면 다른 워크플로우도 이 파일에 씁니다. 열 구성을 맞추세요"}
      </span>
      <div className="chips">
        {FORMATS.map((f) => <button key={f.id} className={t.format === f.id ? "on" : ""} title={f.hint} onClick={() => setT({ format: f.id })}>{f.label}</button>)}
      </div>
      <span className="small muted">{FORMATS.find((f) => f.id === t.format)!.hint}</span>
      <div className="row">
        <Field label="하위 폴더(비워도 됨)"><input className="mono" value={t.dir} placeholder="(바로 아래)" onChange={(e) => setT({ dir: e.target.value.trim() })} /></Field>
        <Field label="파일 이름"><input className="mono" value={t.name} onChange={(e) => setT({ name: e.target.value })} /></Field>
      </div>
      {(dirProblem || nameProblem) && <div className="small" style={{ color: "var(--bad)" }}>{dirProblem ?? nameProblem}</div>}
      {twins.length > 0 && (
        <div className="banner warn small">이 워크플로우의 {twins.map((n) => `「${n.name}」`).join(" · ")}도 같은 파일에 씁니다 — 갈래마다 나눠 쓰는 게 아니라면 파일 이름을 다르게 하세요</div>
      )}

      <Field label="새 파일로 넘어가는 때(롤링)">
        <select value={rollId(t.rolling)} onChange={(e) => setT({ rolling: ROLL_CHOICES.find((c) => c.id === e.target.value)!.make(t.rolling.kind === "sequence" ? t.rolling.limit : null) })}>
          {ROLL_CHOICES.map((c) => <option key={c.id} value={c.id}>{c.label(t.name || "output")}</option>)}
        </select>
      </Field>
      {t.rolling.kind === "sequence" && t.rolling.every !== "run" && (() => {
        const r = t.rolling;
        const mb = r.every === "bytes";
        return (
          <Field label={mb ? "파일 하나의 최대 크기(MB)" : "파일 하나의 최대 행 수"}>
            <input type="number" min={1} style={{ width: 140 }} value={mb ? Math.round((r.limit ?? 0) / 1024 / 1024) || "" : r.limit ?? ""}
              onChange={(e) => { const v = Math.max(1, Number(e.target.value) || 1); setT({ rolling: { ...r, limit: mb ? v * 1024 * 1024 : v } }); }} />
          </Field>
        );
      })()}

      <div className="row">
        <label className="check"><input type="radio" checked={t.mode === "append"} onChange={() => setT({ mode: "append" })} />이어 붙이기</label>
        <label className="check"><input type="radio" checked={t.mode === "overwrite"} onChange={() => setT({ mode: "overwrite" })} />덮어쓰기</label>
      </div>
      <span className="small muted">
        {t.mode === "append" ? "같은 파일이면 뒤에 붙입니다 — " : "같은 파일이면 지우고 새로 씁니다 — "}{describeRolling(t.rolling)}
      </span>
      {!nameProblem && !dirProblem && (
        <div className="name-preview">
          지금 실행하면 → {path(fileNameFor(t, now, 1))}
          {t.rolling.kind === "time" && t.rolling.unit === "day" && <><br />내일 실행하면 → {path(fileNameFor(t, tomorrow, 1))}</>}
          {t.rolling.kind === "sequence" && <><br />(번호는 폴더에 있는 마지막 번호를 보고 정합니다)</>}
        </div>
      )}

      <h3>더 하기</h3>
      <label className="check">
        <input type="checkbox" checked={t.dedupeKey !== null} onChange={(e) => setT({ dedupeKey: e.target.checked ? (t.format === "text" ? "줄" : "링크") : null })} />
        이미 저장한 것은 건너뛰기 {t.mode === "overwrite" && <span className="small muted">(덮어쓰기면 이번 묶음 안에서만)</span>}
      </label>
      {t.dedupeKey !== null && t.format !== "text" && (
        <Field label="같은지 볼 값의 이름" hint="이 값이 같으면 같은 것으로 봅니다 — 뉴스면 「링크」, 주문이면 「주문번호」">
          <input value={t.dedupeKey} onChange={(e) => setT({ dedupeKey: e.target.value })} />
        </Field>
      )}
      {t.dedupeKey !== null && t.format === "text" && <span className="small muted">텍스트는 줄 전체가 같으면 건너뜁니다</span>}
      {t.format !== "text" && (
        <>
          <label className="check">
            <input type="checkbox" checked={t.stampColumn !== null} onChange={(e) => setT({ stampColumn: e.target.checked ? "수집시각" : null })} />
            수집 시각을 함께 적기
          </label>
          {t.stampColumn !== null && <Field label="칸 이름"><input value={t.stampColumn} onChange={(e) => setT({ stampColumn: e.target.value })} /></Field>}
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={t.keepDays !== null} onChange={(e) => setT({ keepDays: e.target.checked ? 30 : null })} />
        오래된 파일 지우기
      </label>
      {t.keepDays !== null && (
        <Field label="며칠 지난 파일을 지울까(일)" hint="쓴 뒤 이 노드의 파일(같은 폴더 · 같은 이름 꼴) 중 바뀐 지 이만큼 지난 것을 지웁니다. 다른 이름의 파일은 건드리지 않습니다">
          <input type="number" min={1} style={{ width: 100 }} value={t.keepDays} onChange={(e) => setT({ keepDays: Math.max(1, Number(e.target.value) || 1) })} />
        </Field>
      )}
      {t.format === "csv" && (
        <>
          <div className="row wrap">
            <label className="check"><input type="checkbox" checked={t.csv.header} onChange={(e) => setT({ csv: { ...t.csv, header: e.target.checked } })} />첫 줄에 열 이름</label>
            <label className="check" title="BOM이 있어야 엑셀이 한글을 깨지 않고 엽니다"><input type="checkbox" checked={t.csv.bom} onChange={(e) => setT({ csv: { ...t.csv, bom: e.target.checked } })} />엑셀 한글(BOM)</label>
          </div>
          <Field label="열 순서(쉼표로 · 비우면 들어온 순서)" hint="적은 열만 씁니다. 이어 붙일 때는 있는 파일의 첫 줄을 따릅니다">
            <input value={(t.csv.columns ?? []).join(", ")} placeholder="제목, 링크, 수집시각"
              onChange={(e) => { const cols = e.target.value.split(",").map((s) => s.trim()).filter(Boolean); setT({ csv: { ...t.csv, columns: cols.length ? cols : null } }); }} />
          </Field>
        </>
      )}

      <SavedFiles flowId={flow.id} target={t} />
    </>
  );
}

/** 이 노드가 쓴 파일들 — 미리 보기 · 내려받기 · 지우기 */
function SavedFiles({ flowId, target: t }: { flowId: string; target: FileStoreTarget }) {
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [root, setRoot] = useState("");
  const [dirOf, setDirOf] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ path: string; text: string; truncated: boolean } | null>(null);
  const reload = () => {
    if (badDir(t.dir)) return;
    api.listStoreFiles(flowId, t.scope, t.dir).then((r) => { setRoot(r.root); setDirOf(r.dir); setError(null); setFiles(r.entries.filter((e) => e.kind === "file" && belongsTo(t, e.name))); },
      (e) => setError(e instanceof ApiError ? e.message : String(e)));
  };
  useEffect(reload, [flowId, t.scope, t.dir, t.name, t.format]);

  return (
    <>
      <div className="row"><h3 className="grow">저장된 파일</h3><button className="small ghost" onClick={reload}>새로고침</button></div>
      {error && <div className="small muted">{error}</div>}
      {root && <span className="small muted mono" title="서버의 저장 파일 뿌리 — FLOWSMITH_FILES_DIR로 바꿉니다. 이 워크플로우 폴더의 이름은 서버가 붙인 uuid입니다">{root}/{dirOf}</span>}
      {files?.length === 0 && <div className="small muted">아직 없습니다 — 워크플로우를 실행하면 여기 생깁니다</div>}
      <div className="file-list">
        {files?.slice(0, 30).map((f) => (
          <div key={f.path} className="file-row">
            <button className="fname ghost" style={{ textAlign: "left" }} title="미리 보기" onClick={() => api.previewFile(f.path).then(setPreview, () => undefined)}>{f.name}</button>
            <span className="fmeta">{size(f.size)} · {dateTime(f.modified)}</span>
            {api.canXlsx(f.name) && <a className="small xlsx-btn" title="엑셀(.xlsx)로 바꿔 받기" href={api.xlsxUrl(f.path)}>엑셀</a>}
            <a className="icon-btn" title="원본 내려받기" href={api.downloadUrl(f.path)}><IconDownload size={14} /></a>
            <button className="icon-btn" title="지우기" onClick={() => { if (confirm(`${f.name}을(를) 지울까요? 되돌릴 수 없습니다.`)) void api.deleteFile(f.path).then(reload, () => undefined); }}><IconTrash size={14} /></button>
          </div>
        ))}
      </div>
      {preview && (
        <div className="subcard">
          <div className="row"><strong className="grow mono small">{preview.path}</strong><button className="icon-btn" onClick={() => setPreview(null)}><IconX size={14} /></button></div>
          <pre className="json file-preview">{preview.text}{preview.truncated ? "\n… (앞부분만 보입니다 — 전체는 내려받으세요)" : ""}</pre>
        </div>
      )}
    </>
  );
}
