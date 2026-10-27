/**
 * 패널 안에서 여러 번 쓰는 부품 — 값 칸(넣을 수 있는 것 고르기) · 요소 위치 편집.
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { LOCATOR_KINDS, paramProblem, parseTemplate, type Flow, type LocatorKind, type ParamDef, type Ref, type Target } from "@flowsmith/core";
import { describeLocator, refLabel, suggestionsFor } from "../model/index.ts";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="small muted">{hint}</span>}
    </label>
  );
}

/** 칸의 조각 — 글자와 값(칩)이 번갈아 온다. 언제나 글자로 시작하고 글자로 끝난다(비어 있어도) */
type Slot = { kind: "text"; text: string } | { kind: "ref"; ref: Ref };

function slotsOf(value: string): Slot[] | null {
  let segs;
  try { segs = parseTemplate(value); } catch { return null; }
  const out: Slot[] = [];
  for (const s of segs) {
    if (s.kind === "text") {
      const last = out.at(-1);
      if (last?.kind === "text") last.text += s.text; else out.push({ kind: "text", text: s.text });
    } else {
      if (out.at(-1)?.kind !== "text") out.push({ kind: "text", text: "" });
      out.push({ kind: "ref", ref: s.ref });
    }
  }
  if (out.at(-1)?.kind !== "text") out.push({ kind: "text", text: "" });
  return out;
}

/** 글자 칸의 너비 — 한글은 한 글자 1em, 영문 · 숫자는 반쯤. 빈 칸은 커서 자리만 */
const textWidth = (t: string): string => `${[...t].reduce((w, ch) => w + (/[\u0000-\u00ff]/.test(ch) ? 0.56 : 1), 0) + 0.3}em`;

const joinSlots = (slots: Slot[]): string => slots.map((s) => (s.kind === "text" ? s.text : `{{ ${s.ref.raw} }}`)).join("");

/**
 * 값 칸 — 글자를 그대로 쓰고, 「＋」로 앞 노드 출력 · 실행 입력 · 변수 · (허용되면) 시크릿을 **칩**으로 끼운다.
 * ★`{{ $input.title }}` 같은 표현식은 보이지 않는다 — 칩에는 「뉴스 읽기 › 제목」처럼 사람 말이 보인다.
 *  표현식 그대로 보고 고치려면 「{ }」(고급 보기).
 * ★시크릿 칩은 색을 달리한다 — 사람이 «여기 비밀번호가 들어간다»를 눈으로 알게.
 */
export function TemplateInput({ value, onChange, flow, nodeId, secrets = false, placeholder }: {
  value: string; onChange: (v: string) => void; flow: Flow; nodeId: string; secrets?: boolean; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState(false);
  const list = suggestionsFor(flow, nodeId, secrets);
  const slots = slotsOf(value);
  /** 마지막으로 글자를 넣던 자리 — 칩을 거기 끼운다 */
  const at = useRef<{ slot: number; caret: number } | null>(null);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const want = useRef<{ slot: number; caret: number } | null>(null);
  useEffect(() => {
    const w = want.current;
    if (!w) return;
    want.current = null;
    const el = boxes.current[w.slot];
    if (el) { el.focus(); el.setSelectionRange(w.caret, w.caret); }
  });
  const showRaw = raw || slots === null;

  const insert = (text: string) => {
    if (showRaw || !slots) { onChange(value + text); return; }
    const pos = at.current && slots[at.current.slot]?.kind === "text" ? at.current : { slot: slots.length - 1, caret: (slots.at(-1) as { text: string }).text.length };
    const cur = slots[pos.slot] as { kind: "text"; text: string };
    const next = [...slots];
    next[pos.slot] = { kind: "text", text: cur.text.slice(0, pos.caret) + text + cur.text.slice(pos.caret) };
    onChange(joinSlots(next));
    want.current = { slot: pos.slot + 2, caret: 0 };
    at.current = want.current;
  };
  const removeRef = (i: number) => {
    if (!slots) return;
    const before = slots[i - 1] as { text: string }, after = slots[i + 1] as { text: string };
    const next: Slot[] = [...slots.slice(0, i - 1), { kind: "text", text: before.text + after.text }, ...slots.slice(i + 2)];
    onChange(joinSlots(next));
    want.current = { slot: i - 1, caret: before.text.length };
  };

  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row">
        {showRaw ? (
          <input className="grow mono" value={value} placeholder={placeholder} autoFocus={slots === null && !raw} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <div className="tpl grow" onClick={(e) => { if (e.target === e.currentTarget) boxes.current[slots!.length - 1]?.focus(); }}>
            {slots!.map((s, i) => s.kind === "text" ? (
              <input key={i} ref={(el) => { boxes.current[i] = el; }} className={`tpl-text${i === slots!.length - 1 ? " last" : ""}`} value={s.text}
                style={i === slots!.length - 1 ? undefined : { width: textWidth(s.text) }} placeholder={slots!.length === 1 ? placeholder : undefined}
                onFocus={(e) => { at.current = { slot: i, caret: e.target.selectionStart ?? s.text.length }; }}
                onSelect={(e) => { at.current = { slot: i, caret: e.currentTarget.selectionStart ?? 0 }; }}
                onKeyDown={(e) => {
                  const el = e.currentTarget;
                  if (e.key === "Backspace" && i > 0 && el.selectionStart === 0 && el.selectionEnd === 0) { e.preventDefault(); removeRef(i - 1); }
                  if (e.key === "ArrowLeft" && i > 0 && el.selectionStart === 0) { e.preventDefault(); want.current = { slot: i - 2, caret: (slots![i - 2] as { text: string }).text.length }; boxes.current[i - 2]?.focus(); }
                  if (e.key === "ArrowRight" && i < slots!.length - 1 && el.selectionStart === s.text.length) { e.preventDefault(); boxes.current[i + 2]?.focus(); boxes.current[i + 2]?.setSelectionRange(0, 0); }
                }}
                onChange={(e) => {
                  const next = [...slots!];
                  next[i] = { kind: "text", text: e.target.value };
                  want.current = { slot: i, caret: e.target.selectionStart ?? e.target.value.length };
                  onChange(joinSlots(next));
                }} />
            ) : (() => {
              const l = refLabel(flow, nodeId, s.ref);
              return (
                <span key={i} className={`tpl-chip k-${l.kind}${l.bad ? " bad" : ""}`} title={l.bad ?? `{{ ${s.ref.raw} }}`}>
                  {l.label}
                  <button type="button" aria-label={`${l.label} 빼기`} onClick={() => removeRef(i)}>×</button>
                </span>
              );
            })())}
          </div>
        )}
        <button type="button" className="small" title="넣을 수 있는 값" aria-expanded={open} onClick={() => setOpen(!open)}>＋ 값</button>
        <button type="button" className={`small ghost tpl-raw${raw ? " on" : ""}`} title={raw ? "칩으로 보기" : "고급 보기 — 표현식 그대로"} aria-pressed={raw} onClick={() => setRaw(!raw)}>{"{ }"} 고급</button>
      </div>
      {slots === null && <span className="small" style={{ color: "var(--bad)" }}>{"{{ }}"} 짝이 맞지 않습니다 — 고치면 칩으로 돌아갑니다</span>}
      {open && (
        <div className="chips">
          {list.length === 0 && <span className="small muted">끼울 값이 없습니다 — 앞 노드를 잇거나, 워크플로우 설정에서 실행 입력 · 변수 · 시크릿을 정하세요</span>}
          {list.map((s) => (
            <button type="button" key={s.insert} className={s.secret ? "secret" : ""} onClick={() => { insert(s.insert); setOpen(false); }}>{s.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

const KIND_LABEL: Record<LocatorKind, string> = {
  role: "역할 + 이름", label: "칸 이름", placeholder: "안내 글자", text: "보이는 글자", testid: "테스트 id", css: "CSS", xpath: "XPath",
};

/**
 * 요소 위치 — 사람 말 이름 + 1순위 위치.
 * ★실행은 1순위만 쓴다(결정 3). 나머지 후보는 실패할 때 보여 주는 용도라 여기서는 읽기만 하고,
 *  사람이 «이걸 1순위로»를 눌러야 바뀐다.
 */
export function TargetEditor({ target, onChange, title = "요소" }: { target: Target; onChange: (t: Target) => void; title?: string }) {
  const primary = target.locators[0] ?? { kind: "css" as const, value: "" };
  const setPrimary = (p: typeof primary) => onChange({ ...target, locators: [p, ...target.locators.slice(1)], verifiedAt: null });
  return (
    <div className="subcard">
      <Field label={`${title} — 사람이 부르는 이름`}>
        <input value={target.label} placeholder="'로그인' 버튼" onChange={(e) => onChange({ ...target, label: e.target.value })} />
      </Field>
      <div className="row">
        <Field label="찾는 방법">
          <select value={primary.kind} onChange={(e) => setPrimary({ kind: e.target.value as LocatorKind, value: primary.value })}>
            {LOCATOR_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <div className="grow">
          <Field label={primary.kind === "role" ? "역할 (button · link · textbox …)" : "값"}>
            <input className="mono" value={primary.value} onChange={(e) => setPrimary({ ...primary, value: e.target.value })} />
          </Field>
        </div>
        {primary.kind === "role" && (
          <div className="grow">
            <Field label="이름"><input value={primary.name ?? ""} onChange={(e) => setPrimary({ ...primary, ...(e.target.value ? { name: e.target.value } : { name: undefined }) })} /></Field>
          </div>
        )}
      </div>
      <Field label="iframe 경로 (바깥부터, 쉼표로)" hint="iframe 안의 요소일 때만">
        <input className="mono" value={target.frames.join(", ")} onChange={(e) => onChange({ ...target, frames: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
      </Field>
      {target.locators.length > 1 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="small muted">다른 후보 — 실행에는 쓰지 않습니다. 1순위가 깨졌을 때 고르는 데 씁니다</span>
          {target.locators.slice(1).map((l, i) => (
            <div key={i} className="row small">
              <span className="grow mono">{describeLocator(l)}</span>
              <button type="button" className="small" onClick={() => {
                const rest = target.locators.filter((_, j) => j !== i + 1);
                onChange({ ...target, locators: [l, ...rest], verifiedAt: null });
              }}>1순위로</button>
            </div>
          ))}
        </div>
      )}
      <span className="small muted">{target.verifiedAt ? `마지막 확인 ${new Date(target.verifiedAt).toLocaleString("ko-KR")}` : "아직 확인 안 됨 — M4 레코더로 지정하면 확인됩니다"}</span>
    </div>
  );
}

export function Toast({ text, action }: { text: string | null; action?: { label: string; run: () => void } | null }) {
  return text ? <div className="toast" role="status">{text}{action && <button className="toast-action" onClick={action.run}>{action.label}</button>}</div> : null;
}

/** 실행 입력 하나 — 종류에 맞는 칸(날짜는 달력 · 고르기는 목록 · 숫자는 숫자 자판). 틀리면 아래에 까닭 */
export function ParamInput({ def, value, onChange, onEnter, autoFocus }: { def: ParamDef; value: string; onChange: (v: string) => void; onEnter?: () => void; autoFocus?: boolean }) {
  const bad = value.trim() !== "" ? paramProblem(def, value) : null;
  const key = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") onEnter?.(); };
  return (
    <label className="field">
      <span>{def.label || def.name}{def.required ? " *" : ""}</span>
      {def.type === "select" ? (
        <select value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)}>
          <option value="">{def.required ? "고르세요" : "(없음)"}</option>
          {def.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input value={value} autoFocus={autoFocus} type={def.type === "date" ? "date" : "text"} inputMode={def.type === "number" ? "decimal" : undefined}
          placeholder={def.default ? `비우면 ${def.default}` : ""} onChange={(e) => onChange(e.target.value)} onKeyDown={key} />
      )}
      {bad ? <em className="field-bad">{bad}</em> : def.help ? <em className="field-help">{def.help}</em> : null}
    </label>
  );
}

/**
 * 쉼표로 여럿 — 친 글자는 그대로 두고 목록만 넘긴다.
 * ★목록에서 다시 글자를 만들면 «a,»의 쉼표가 바로 지워져 둘째 것을 칠 수 없다
 */
export function ListInput({ value, onChange, placeholder, className, style }: { value: readonly string[]; onChange: (v: string[]) => void; placeholder?: string; className?: string; style?: CSSProperties }) {
  const parse = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const [text, setText] = useState(value.join(", "));
  // 밖에서 바뀌었으면(되돌리기 · 다른 플로우) 글자를 맞춘다
  useEffect(() => { if (parse(text).join("\u0000") !== value.join("\u0000")) setText(value.join(", ")); }, [value]);   // eslint-disable-line react-hooks/exhaustive-deps
  return <input className={className} style={style} placeholder={placeholder} value={text} onChange={(e) => { setText(e.target.value); onChange(parse(e.target.value)); }} />;
}
