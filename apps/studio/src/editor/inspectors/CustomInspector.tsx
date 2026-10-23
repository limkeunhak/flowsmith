/** 커스텀 노드 — 코드 · 내보낼 이름 · page 사용 */
import { type CustomNode } from "@flowsmith/core";
import { Field } from "../widgets.tsx";

type Update<T> = (fn: (n: T) => T) => void;

// ─── 커스텀 ─────────────────────────────────────────────────────────

export function CustomInspector({ node, update }: { node: CustomNode; update: Update<CustomNode> }) {
  const cfg = node.config;
  const set = (patch: Partial<CustomNode["config"]>) => update((n) => ({ ...n, config: { ...n.config, ...patch } }));
  return (
    <>
      <div className="banner warn">★ 이 노드는 <b>안전장치 밖</b>에서 돕니다. 날 Playwright <code>page</code>를 받으므로 금지 버튼 검사가 걸리지 않습니다.</div>
      <Field label="코드 — async 함수 몸통. input · page · ctx를 받아 객체를 돌려줍니다">
        <textarea className="code" spellCheck={false} value={cfg.code}
          onKeyDown={(e) => {
            if (e.key !== "Tab") return;
            e.preventDefault();
            const t = e.currentTarget;
            const s = t.selectionStart;
            const v = t.value.slice(0, s) + "  " + t.value.slice(t.selectionEnd);
            set({ code: v });
            requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
          }}
          onChange={(e) => set({ code: e.target.value })} />
      </Field>
      <Field label="내보낼 이름들 (쉼표로)" hint="돌려준 객체에서 이 이름들만 뒤 노드로 갑니다">
        <input value={cfg.outputs.join(", ")} onChange={(e) => set({ outputs: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
      </Field>
      <div className="row">
        <label className="check grow"><input type="checkbox" checked={cfg.usesPage} onChange={(e) => set({ usesPage: e.target.checked })} />브라우저 페이지를 씁니다(page)</label>
        <Field label="시간 제한(ms)">
          <input type="number" style={{ width: 100 }} value={cfg.timeoutMs ?? ""} placeholder="30000" onChange={(e) => set({ timeoutMs: e.target.value === "" ? null : Math.max(1, Number(e.target.value)) })} />
        </Field>
      </div>
    </>
  );
}

