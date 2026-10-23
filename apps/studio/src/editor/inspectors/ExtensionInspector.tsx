/** 확장 노드 — 워커에 설치된 확장의 값 · 내보내는 값 */
import { useEffect, useState } from "react";
import { type Flow, type ExtensionNode } from "@flowsmith/core";
import { listExtensions, type ExtensionMeta } from "../../api.ts";
import { Field, TemplateInput } from "../widgets.tsx";

type Update<T> = (fn: (n: T) => T) => void;

// ─── 확장 ───────────────────────────────────────────────────────────

export function ExtensionInspector({ flow, node, update }: { flow: Flow; node: ExtensionNode; update: Update<ExtensionNode> }) {
  const [metas, setMetas] = useState<ExtensionMeta[] | null>(null);
  useEffect(() => { void listExtensions().then(setMetas); }, []);
  const cfg = node.config;
  const meta = metas?.find((m) => m.id === cfg.extension) ?? null;
  const setOption = (k: string, v: string) => update((n) => ({ ...n, config: { ...n.config, options: { ...n.config.options, [k]: v } } }));
  const pii = new Set(meta?.pii ?? []);
  const outOfSync = meta !== null && JSON.stringify(meta.outputs) !== JSON.stringify(cfg.outputs);
  return (
    <>
      {metas !== null && meta === null && (
        <div className="banner bad">이 워커에 확장 <code>{cfg.extension}</code>이(가) 설치돼 있지 않습니다 — 서버를 띄울 때 FLOWSMITH_EXTENSIONS에 넣으세요. 실행하면 이 노드에서 멈춥니다.</div>
      )}
      {meta && (
        <div className="subcard">
          <strong>{meta.title}</strong>
          <span className="small muted">{meta.description}</span>
          <div className="row wrap">
            <span className="pill mono">{meta.id}</span>
            {meta.browser === "attach" && <span className="pill accent">사람이 로그인한 크롬에서 돕니다</span>}
            {meta.risk === "unsafe" && <span className="pill warn">되돌릴 수 없는 일을 합니다</span>}
          </div>
        </div>
      )}
      {(meta?.options ?? Object.keys(cfg.options).map((name) => ({ name, label: name, required: false, hint: undefined as string | undefined }))).map((o) => (
        <Field key={o.name} label={`${o.label}${o.required ? " *" : ""}`} {...(o.hint ? { hint: o.hint } : {})}>
          <TemplateInput flow={flow} nodeId={node.id} value={cfg.options[o.name] ?? ""} onChange={(v) => setOption(o.name, v)} />
        </Field>
      ))}
      <h3>내보내는 값</h3>
      <div className="chips">
        {cfg.outputs.map((o) => <span key={o} className={`pill${pii.has(o) ? " warn" : ""}`} title={pii.has(o) ? "개인정보 — 다음 노드로는 가지만 실행 기록 · 화면에는 가려 둡니다" : ""}>{o}{pii.has(o) ? " · 개인정보" : ""}</span>)}
      </div>
      {outOfSync && (
        <button className="small" onClick={() => update((n) => ({ ...n, config: { ...n.config, outputs: [...meta!.outputs] } }))}>확장이 알려 준 출력으로 맞추기</button>
      )}
    </>
  );
}
