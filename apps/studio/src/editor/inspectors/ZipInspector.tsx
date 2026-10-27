/** 압축(zip) 노드 — 묶을 폴더 · 포함 규칙 · 결과 폴더 · 이름 · 이미 있으면 · 만든 zip 받기 (PLAN §52) */
import { useEffect, useState } from "react";
import { badDir, type Flow, type StoreScope, type ZipConfig, type ZipNode } from "@flowsmith/core";
import { api, ApiError, type FileEntry } from "../../api.ts";
import { IconDownload } from "../../icons.tsx";
import { Field, TemplateInput } from "../widgets.tsx";
import { dateTime } from "../../format.ts";

type Update = (fn: (n: ZipNode) => ZipNode) => void;
const size = (n: number) => (n < 1024 ? `${n}B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);
const hasExpr = (s: string) => s.includes("{{");

export function ZipInspector({ flow, node, update }: { flow: Flow; node: ZipNode; update: Update }) {
  const c = node.config;
  const set = (fn: (c: ZipConfig) => ZipConfig) => update((n) => ({ ...n, config: fn(n.config) }));
  const Scope = ({ value, onChange }: { value: StoreScope; onChange: (s: StoreScope) => void }) => (
    <div className="row">
      <label className="check"><input type="radio" checked={value === "flow"} onChange={() => onChange("flow")} />이 워크플로우 폴더</label>
      <label className="check"><input type="radio" checked={value === "shared"} onChange={() => onChange("shared")} />공유 폴더</label>
    </div>
  );
  const fromProblem = hasExpr(c.from.dir) ? null : badDir(c.from.dir);
  const toProblem = hasExpr(c.to.dir) ? null : badDir(c.to.dir);
  return (
    <>
      <h3>무엇을 묶나</h3>
      <Scope value={c.from.scope} onChange={(scope) => set((x) => ({ ...x, from: { ...x.from, scope } }))} />
      <Field label="폴더(비우면 폴더 전체)" hint="그 아래 하위 폴더까지 묶습니다 — 예: pdf · capture">
        <TemplateInput flow={flow} nodeId={node.id} value={c.from.dir} placeholder="pdf" onChange={(dir) => set((x) => ({ ...x, from: { ...x.from, dir } }))} />
      </Field>
      {fromProblem && <span className="small" style={{ color: "var(--danger)" }}>{fromProblem}</span>}
      <Field label="포함 규칙(한 줄에 하나 · 비우면 모두)" hint="**/*.pdf — 하위 폴더까지 PDF만 · *.csv — 그 폴더의 CSV만. 대소문자는 가리지 않습니다">
        <textarea className="mono" rows={2} value={c.from.include.join("\n")} placeholder="**/*.pdf"
          onChange={(e) => set((x) => ({ ...x, from: { ...x.from, include: e.target.value.split("\n").map((l) => l.trim()).filter((l) => l !== "") } }))} />
      </Field>

      <h3>어디에</h3>
      <Scope value={c.to.scope} onChange={(scope) => set((x) => ({ ...x, to: { ...x.to, scope } }))} />
      <div className="row wrap">
        <Field label="폴더(비워도 됨)">
          <TemplateInput flow={flow} nodeId={node.id} value={c.to.dir} placeholder="" onChange={(dir) => set((x) => ({ ...x, to: { ...x.to, dir } }))} />
        </Field>
        <Field label="이름(.zip은 붙여 줍니다)">
          <TemplateInput flow={flow} nodeId={node.id} value={c.to.name} placeholder="묶음-{{ $params.day }}" onChange={(name) => set((x) => ({ ...x, to: { ...x.to, name } }))} />
        </Field>
        <Field label="이미 있으면">
          <select value={c.ifExists} onChange={(e) => set((x) => ({ ...x, ifExists: e.target.value as ZipConfig["ifExists"] }))}>
            <option value="overwrite">덮어쓰기</option>
            <option value="fail">멈추기</option>
          </select>
        </Field>
      </div>
      {toProblem && <span className="small" style={{ color: "var(--danger)" }}>{toProblem}</span>}
      <span className="small muted">
        압축은 파일이 있는 서버에서 합니다. 한글 이름은 그대로(UTF-8) · PDF · 그림처럼 이미 압축된 것은 다시 누르지 않고 담습니다. 결과 zip 자신은 묶지 않습니다.
        ZIP64를 쓰지 않아 65,535개 · 4GB를 넘으면 멈춥니다 — 포함 규칙으로 나눠 묶으세요. 출력: file(zip 경로) · count(파일 수) · bytes(크기).
      </span>
      {!hasExpr(c.to.dir) && !toProblem && <Zips flowId={flow.id} scope={c.to.scope} dir={c.to.dir} />}
    </>
  );
}

/** 결과 폴더의 zip들 — 내려받기 */
function Zips({ flowId, scope, dir }: { flowId: string; scope: StoreScope; dir: string }) {
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => {
    api.listStoreFiles(flowId, scope, dir).then((r) => { setError(null); setFiles(r.entries.filter((e) => e.kind === "file" && /\.zip$/iu.test(e.name))); },
      (e) => setError(e instanceof ApiError ? e.message : String(e)));
  };
  useEffect(reload, [flowId, scope, dir]);
  return (
    <>
      <div className="row"><h3 className="grow">만든 zip</h3><button className="small ghost" onClick={reload}>새로고침</button></div>
      {error && <div className="small muted">{error}</div>}
      {files?.length === 0 && <div className="small muted">아직 없습니다 — 워크플로우를 실행하면 여기 생깁니다</div>}
      <div className="file-list">
        {files?.slice(0, 30).map((f) => (
          <div key={f.path} className="file-row">
            <span className="fname">{f.name}</span>
            <span className="fmeta">{size(f.size)} · {dateTime(f.modified)}</span>
            <a className="icon-btn" title="내려받기" href={api.downloadUrl(f.path)}><IconDownload size={14} /></a>
          </div>
        ))}
      </div>
    </>
  );
}
