/**
 * 가이드 문서의 작은 마크다운 — 제목(# ## ###) · 문단 · 목록(- 1.) · 표 · 인용(알림 상자) · 코드 블록 · 굵게 · `코드` · [링크](주소).
 * ★HTML을 그대로 넣지 않는다(innerHTML 없음) — 글은 모두 React의 글자로 그린다.
 * 제목마다 id(슬러그)를 붙여 «이 페이지에서»가 그리로 간다.
 */
import type { ReactNode } from "react";

export interface Heading { level: 2 | 3; text: string; id: string }

/** 제목 글자 → id — 한글은 그대로, 띄어쓰기는 -로 */
export const slug = (s: string): string => s.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-");

/** 줄 안 — **굵게** · `코드` · [글](주소) */
function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={`${key}${i++}`}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<code key={`${key}${i++}`}>{m[2]}</code>);
    else {
      const href = m[4]!;
      const safe = /^(#|https?:\/\/)/.test(href) ? href : "#";
      out.push(<a key={`${key}${i++}`} href={safe} {...(safe.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>{m[3]}</a>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cellsOf = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/** 문서 하나를 그린다 — 제목 목록도 함께 */
export function renderMarkdown(src: string): { title: string; body: ReactNode[]; headings: Heading[] } {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const body: ReactNode[] = [];
  const headings: Heading[] = [];
  let title = "";
  let i = 0, k = 0;
  const key = () => `b${k++}`;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") { i++; continue; }
    // 코드 블록
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) buf.push(lines[i++]!);
      i++;
      body.push(<pre key={key()} className="doc-code"><code>{buf.join("\n")}</code></pre>);
      continue;
    }
    // 제목
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length, text = h[2]!.trim();
      if (level === 1) title = text;
      else {
        const id = slug(text);
        headings.push({ level: level as 2 | 3, text, id });
        body.push(level === 2 ? <h2 key={key()} id={id}>{inline(text)}</h2> : <h3 key={key()} id={id}>{inline(text)}</h3>);
      }
      i++;
      continue;
    }
    // 표
    if (line.trim().startsWith("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const head = cellsOf(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(cellsOf(lines[i++]!));
      body.push(
        <div key={key()} className="doc-table"><table>
          <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `h${j}`)}</th>)}</tr></thead>
          <tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, n) => <td key={n}>{inline(c, `c${j}-${n}`)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    // 알림 상자(인용)
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) buf.push(lines[i++]!.replace(/^>\s?/, ""));
      body.push(<div key={key()} className="doc-note">{inline(buf.join(" "))}</div>);
      continue;
    }
    // 목록
    const ul = /^\s*-\s+/, ol = /^\s*\d+\.\s+/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? ol : ul).test(lines[i]!)) items.push(lines[i++]!.replace(ordered ? ol : ul, ""));
      const li = items.map((t, j) => <li key={j}>{inline(t, `l${j}`)}</li>);
      body.push(ordered ? <ol key={key()}>{li}</ol> : <ul key={key()}>{li}</ul>);
      continue;
    }
    // 문단 — 빈 줄 · 다른 덩이까지
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "" && !/^(#{1,3}\s|```|>|\s*-\s|\s*\d+\.\s|\s*\|)/.test(lines[i]!)) buf.push(lines[i++]!.trim());
    if (buf.length === 0) { i++; continue; }
    body.push(<p key={key()}>{inline(buf.join(" "))}</p>);
  }
  return { title, body, headings };
}

/** 찾기에 쓰는 맨 글자 — 마크다운 기호를 뺀다 */
export const plainText = (src: string): string => src.replace(/```[\s\S]*?```/g, " ").replace(/[#>*`|[\]()-]/g, " ").replace(/\s+/g, " ");
