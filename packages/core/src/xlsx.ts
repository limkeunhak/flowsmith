/**
 * **엑셀(.xlsx) 만들기** — 순수하다(브라우저 · 서버 둘 다). 라이브러리 없이 — 시트 XML을 압축 없이(stored) ZIP으로 묶는다.
 *
 *   편집 화면  실행 결과 표 → 「엑셀로 받기」
 *   서버      파일 쓰기 노드가 쓴 CSV · JSON → 엑셀로 내려받기 · 메일 알림에 결과 붙이기
 *
 * ★값은 바꾸지 않는다 — 숫자는 숫자 칸, 참/거짓은 참/거짓 칸, 나머지는 글자 칸. 객체는 JSON 글자로.
 *  「00123」 같은 글자는 글자로 남는다(엑셀이 앞의 0을 지우지 않게).
 */
import { toRows, type Row } from "./nodes/transform.ts";

export interface Sheet {
  name: string;
  rows: Row[];
  /** 열 순서 — 없으면 행들에 나온 순서대로 */
  columns?: string[];
}

/** 출력에서 표로 보일 것 — 값이 목록인 칸마다 한 장(「rows」 · 「results」 …) */
export function tablesOf(output: unknown): Sheet[] {
  if (output === null || typeof output !== "object") return [];
  if (Array.isArray(output)) return output.length ? [{ name: "결과", rows: toRows(output) }] : [];
  return Object.entries(output as Record<string, unknown>)
    .filter(([, v]) => Array.isArray(v) && v.length > 0)
    .map(([k, v]) => ({ name: k, rows: toRows(v) }));
}

export function columnsOf(rows: readonly Row[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

// ─── ZIP (stored) ─────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, 0, true); local.setUint16(12, 0x21, true); local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true); local.setUint32(22, f.data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, 0, true); cd.setUint16(14, 0x21, true); cd.setUint32(16, crc, true); cd.setUint32(20, f.data.length, true); cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

// ─── 시트 ──────────────────────────────────────────────────────────

const esc = (s: string) => s
  // XML에 넣을 수 없는 제어 글자는 뺀다
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const colName = (i: number): string => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/** 시트 이름 — 31자 · []:*?/\ 빼고 · 겹치지 않게 */
function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((n, i) => {
    let base = (n.replace(/[[\]:*?/\\]/g, " ").trim() || `시트${i + 1}`).slice(0, 31);
    let name = base;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base.slice(0, 28)}(${k})`;
    used.add(name.toLowerCase());
    return name;
  });
}

function cell(ref: string, v: unknown, style = 0): string {
  const s = style ? ` s="${style}"` : "";
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  if (typeof v === "boolean") return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
  const text = (typeof v === "object" ? JSON.stringify(v) : String(v)).slice(0, 32_767);
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

function sheetXml(sh: Sheet): string {
  const cols = sh.columns ?? columnsOf(sh.rows);
  const width = (i: number) => {
    const longest = Math.max(cols[i]!.length, ...sh.rows.slice(0, 200).map((r) => { const v = r[cols[i]!]; return v === null || v === undefined ? 0 : String(typeof v === "object" ? JSON.stringify(v) : v).length; }));
    return Math.min(60, Math.max(8, Math.ceil(longest * 1.6) + 2));
  };
  const head = `<row r="1">${cols.map((c, i) => cell(`${colName(i)}1`, c, 1)).join("")}</row>`;
  const body = sh.rows.map((r, ri) => `<row r="${ri + 2}">${cols.map((c, ci) => cell(`${colName(ci)}${ri + 2}`, r[c])).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + (cols.length ? `<cols>${cols.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${width(i)}" customWidth="1"/>`).join("")}</cols>` : "")
    + `<sheetData>${cols.length ? head : ""}${body}</sheetData></worksheet>`;
}

/** 시트들 → .xlsx 바이트. 시트가 없으면 빈 시트 하나 */
export function toXlsx(sheets: readonly Sheet[]): Uint8Array<ArrayBuffer> {
  const list = sheets.length ? sheets : [{ name: "결과", rows: [] }];
  const names = sheetNames(list.map((s) => s.name));
  const enc = new TextEncoder();
  const f = (name: string, xml: string) => ({ name, data: enc.encode(xml) });
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  return zip([
    f("[Content_Types].xml", `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    f("_rels/.rels", `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    f("xl/workbook.xml", `${X}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    f("xl/_rels/workbook.xml.rels", `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    f("xl/styles.xml", `${X}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F3F5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
    ...list.map((s, i) => f(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s))),
  ]);
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
