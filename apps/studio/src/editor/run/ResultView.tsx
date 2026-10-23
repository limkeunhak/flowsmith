/**
 * 결과 보기 — 목록이 든 출력은 **표로** 보이고 「엑셀로 받기」가 붙는다. 목록이 없으면 JSON.
 * 실행 로그(노드 출력 · 플로우 결과)와 값 다듬기의 미리 보기가 같이 쓴다.
 */
import { useState } from "react";
import { columnsOf, tablesOf, toXlsx, XLSX_TYPE, type Row } from "@flowsmith/core";
import { IconDownload } from "../../icons.tsx";

const show = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

/** 표 — 앞 limit행만 보인다(엑셀에는 다 들어간다) */
export function DataTable({ rows, limit = 200 }: { rows: Row[]; limit?: number }) {
  if (rows.length === 0) return <div className="small muted">행이 없습니다</div>;
  const cols = columnsOf(rows.slice(0, 50));
  return (
    <div className="data-table">
      <table>
        <thead><tr><th className="rn">#</th>{cols.map((k) => <th key={k}>{k}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, limit).map((r, i) => <tr key={i}><td className="rn">{i + 1}</td>{cols.map((k) => <td key={k} title={show(r[k])}>{show(r[k])}</td>)}</tr>)}
        </tbody>
      </table>
      {rows.length > limit && <div className="small muted" style={{ padding: "4px 8px" }}>… {rows.length - limit}행 더 — 엑셀로 받으면 다 들어갑니다</div>}
    </div>
  );
}

/** 엑셀 파일로 내려받는다 — 브라우저 안에서 만든다(서버를 거치지 않는다) */
export function downloadXlsx(sheets: { name: string; rows: Row[] }[], baseName: string): void {
  const bytes = toXlsx(sheets);
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_TYPE }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName.replace(/[\\/:*?"<>|]+/g, " ").trim() || "결과"}-${stamp()}.xlsx`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ResultView({ value, fileName }: { value: unknown; fileName: string }) {
  const tables = tablesOf(value);
  const [mode, setMode] = useState<"table" | "json">("table");
  const [pick, setPick] = useState(0);
  if (tables.length === 0) return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
  const t = tables[Math.min(pick, tables.length - 1)]!;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row wrap">
        <div className="seg-tabs small">
          <button className={mode === "table" ? "on" : ""} onClick={() => setMode("table")}>표</button>
          <button className={mode === "json" ? "on" : ""} onClick={() => setMode("json")}>JSON</button>
        </div>
        {mode === "table" && tables.length > 1 && (
          <div className="chips">{tables.map((x, i) => <button key={x.name} className={i === pick ? "on" : ""} onClick={() => setPick(i)}>{x.name} ({x.rows.length})</button>)}</div>
        )}
        <span className="grow" />
        <button className="small" title="표를 엑셀 파일로 — 목록마다 시트 한 장" onClick={() => downloadXlsx(tables, fileName)}><IconDownload size={14} /> 엑셀로 받기</button>
      </div>
      {mode === "table" ? (
        <>
          <div className="small muted">{t.name} · {t.rows.length}행</div>
          <DataTable rows={t.rows} />
        </>
      ) : <pre className="json">{JSON.stringify(value, null, 2)}</pre>}
    </div>
  );
}
