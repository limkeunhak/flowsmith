/**
 * **가이드** (PLAN §30) — 이 서비스를 쓰는 법. #/docs · #/docs/<문서>.
 * 왼쪽은 목차와 찾기, 가운데는 문서, 오른쪽은 «이 페이지에서»(넓은 화면). 문서는 content/*.md(앱에 함께 묶는다).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { IconSearch } from "../icons.tsx";
import { plainText, renderMarkdown } from "./markdown.tsx";
import start from "./content/start.md?raw";
import flows from "./content/flows.md?raw";
import recording from "./content/recording.md?raw";
import nodes from "./content/nodes.md?raw";
import values from "./content/values.md?raw";
import aiDoc from "./content/ai.md?raw";
import running from "./content/running.md?raw";
import tests from "./content/tests.md?raw";
import wallet from "./content/wallet.md?raw";
import notify from "./content/notify.md?raw";
import monitor from "./content/monitor.md?raw";
import files from "./content/files.md?raw";
import workers from "./content/workers.md?raw";
import plugins from "./content/plugins.md?raw";
import people from "./content/people.md?raw";
import apiDoc from "./content/api.md?raw";
import troubleshooting from "./content/troubleshooting.md?raw";

interface Page { slug: string; group: string; src: string }
const PAGES: Page[] = [
  { slug: "start", group: "시작", src: start },
  { slug: "flows", group: "만들기", src: flows },
  { slug: "recording", group: "만들기", src: recording },
  { slug: "nodes", group: "만들기", src: nodes },
  { slug: "values", group: "만들기", src: values },
  { slug: "ai", group: "만들기", src: aiDoc },
  { slug: "running", group: "실행과 운영", src: running },
  { slug: "tests", group: "실행과 운영", src: tests },
  { slug: "wallet", group: "실행과 운영", src: wallet },
  { slug: "notify", group: "실행과 운영", src: notify },
  { slug: "monitor", group: "실행과 운영", src: monitor },
  { slug: "files", group: "실행과 운영", src: files },
  { slug: "workers", group: "관리", src: workers },
  { slug: "plugins", group: "관리", src: plugins },
  { slug: "people", group: "관리", src: people },
  { slug: "api", group: "관리", src: apiDoc },
  { slug: "troubleshooting", group: "도움", src: troubleshooting },
];
const titleOf = (src: string) => /^#\s+(.+)$/m.exec(src)?.[1]?.trim() ?? "";
const GROUPS = [...new Set(PAGES.map((p) => p.group))];

export function Docs({ slug }: { slug: string | null }) {
  const page = PAGES.find((p) => p.slug === slug) ?? PAGES[0]!;
  const doc = useMemo(() => renderMarkdown(page.src), [page]);
  const [q, setQ] = useState("");
  const body = useRef<HTMLElement>(null);
  const index = useMemo(() => PAGES.map((p) => ({ ...p, title: titleOf(p.src), text: plainText(p.src) })), []);
  const found = q.trim() ? index.filter((p) => p.text.toLowerCase().includes(q.trim().toLowerCase())) : null;
  const at = PAGES.indexOf(page);
  const prev = PAGES[at - 1], next = PAGES[at + 1];

  // 문서를 바꾸면 맨 위로
  useEffect(() => { document.querySelector(".app-main")?.scrollTo({ top: 0 }); }, [page]);
  const jump = (id: string) => body.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const snippet = (text: string) => {
    const i = text.toLowerCase().indexOf(q.trim().toLowerCase());
    return i < 0 ? "" : `${i > 30 ? "…" : ""}${text.slice(Math.max(0, i - 30), i + 50)}…`;
  };

  return (
    <div className="docs">
      <aside className="docs-nav">
        <div className="docs-search">
          <IconSearch size={15} />
          <input placeholder="가이드에서 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="가이드에서 찾기" />
        </div>
        {found ? (
          <div className="docs-found">
            {found.length === 0 && <div className="small muted">찾는 내용이 없습니다</div>}
            {found.map((p) => (
              <a key={p.slug} href={`#/docs/${p.slug}`} onClick={() => setQ("")}><b>{p.title}</b><span>{snippet(p.text)}</span></a>
            ))}
          </div>
        ) : GROUPS.map((g) => (
          <div key={g} className="docs-group">
            <div className="docs-group-title">{g}</div>
            {index.filter((p) => p.group === g).map((p) => (
              <a key={p.slug} href={`#/docs/${p.slug}`} className={p.slug === page.slug ? "on" : ""}>{p.title}</a>
            ))}
          </div>
        ))}
        <select className="docs-pick" value={page.slug} aria-label="문서" onChange={(e) => { location.hash = `#/docs/${e.target.value}`; }}>
          {GROUPS.map((g) => <optgroup key={g} label={g}>{index.filter((p) => p.group === g).map((p) => <option key={p.slug} value={p.slug}>{p.title}</option>)}</optgroup>)}
        </select>
      </aside>

      <article className="doc" ref={body}>
        <div className="doc-crumb">{page.group}</div>
        <h1>{doc.title}</h1>
        {doc.body}
        <nav className="doc-pager">
          {prev ? <a href={`#/docs/${prev.slug}`}><span>이전</span><b>{titleOf(prev.src)}</b></a> : <span />}
          {next ? <a href={`#/docs/${next.slug}`} className="next"><span>다음</span><b>{titleOf(next.src)}</b></a> : <span />}
        </nav>
      </article>

      <aside className="docs-toc">
        {doc.headings.length > 0 && <div className="docs-group-title">이 페이지에서</div>}
        {doc.headings.map((h) => (
          <button key={h.id} className={`toc-item l${h.level}`} onClick={() => jump(h.id)}>{h.text}</button>
        ))}
      </aside>
    </div>
  );
}
