/** 웹페이지 노드 — 시작 · 동작 목록 · 동작마다의 칸 (레코더가 채운 것을 다듬는 자리) */
import { useState } from "react";
import {
  ACTION_KINDS, CONDITION_OPS, HUMAN_TIMEOUT, WALLET_APPROVE_TIMEOUT, READ_STRATEGIES, RELOAD_WAIT, STABLE_WAIT, UNARY_OPS, WAIT_KINDS, type ConditionOp, type HumanDone, type Flow, type ProbeFinding, type Rule, type Wait, type WebAction, type WebNode,
} from "@flowsmith/core";
import { FindingCard } from "../monitor/Monitor.tsx";
import { ACTION_LABEL, describeAction, emptyTarget, newAction } from "../../model/index.ts";
import { Field, TargetEditor, TemplateInput } from "../widgets.tsx";
import { IconX } from "../../icons.tsx";

import { OP_LABEL } from "./ConditionInspector.tsx";

type Update<T> = (fn: (n: T) => T) => void;

// ─── 웹페이지 ───────────────────────────────────────────────────────

export function WebInspector({ flow, node, update, findings, onRepick, onSplitAt }: { flow: Flow; node: WebNode; update: Update<WebNode>; findings: ProbeFinding[]; onRepick?: (actionId: string) => void; onSplitAt?: (i: number) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [addKind, setAddKind] = useState<WebAction["kind"]>("click");
  const start = node.config.start;
  const setActions = (fn: (a: WebAction[]) => WebAction[]) => update((n) => ({ ...n, config: { ...n.config, actions: fn(n.config.actions) } }));
  const move = (i: number, d: -1 | 1) => setActions((as) => {
    const j = i + d;
    if (j < 0 || j >= as.length) return as;
    const c = [...as];
    [c[i], c[j]] = [c[j]!, c[i]!];
    return c;
  });

  return (
    <>
      <h3>어디서 시작하나</h3>
      <div className="row">
        <label className="check"><input type="radio" checked={start.kind === "url"} onChange={() => update((n) => ({ ...n, config: { ...n.config, start: { kind: "url", url: "" } } }))} />주소로 가서</label>
        <label className="check"><input type="radio" checked={start.kind === "continue"} onChange={() => update((n) => ({ ...n, config: { ...n.config, start: { kind: "continue" } } }))} />앞 페이지에서 이어서</label>
        {flow.settings.browser === "attach" && (
          <label className="check"><input type="radio" checked={start.kind === "tab"} onChange={() => update((n) => ({ ...n, config: { ...n.config, start: { kind: "tab", match: "" } } }))} />사람이 연 탭에서</label>
        )}
      </div>
      {start.kind === "tab" && (
        <Field label="탭 주소에 든 글자" hint="사람이 로그인해 둔 탭 중 주소에 이 글자가 든 탭에서 시작합니다 — 주소를 옮기지 않습니다(WebSquare 같은 화면이 날아가지 않게)">
          <input className="mono" value={start.match} placeholder="portal.example.co.kr" onChange={(e) => update((n) => ({ ...n, config: { ...n.config, start: { kind: "tab", match: e.target.value } } }))} />
        </Field>
      )}
      {start.kind === "url" && (
        <TemplateInput flow={flow} nodeId={node.id} value={start.url} placeholder="https://… 또는 {{ $vars.baseUrl }}/login"
          onChange={(url) => update((n) => ({ ...n, config: { ...n.config, start: { kind: "url", url } } }))} />
      )}

      {start.kind !== "tab" && <EachEditor flow={flow} node={node} update={update} />}

      <h3>하는 일 ({node.config.actions.length})</h3>
      <div className="stack" style={{ gap: 6 }}>
        {node.config.actions.map((a, i) => (
          <div key={a.id} className="action">
            <div className="summary" onClick={() => setOpen(open === a.id ? null : a.id)}>
              <span className="n">{i + 1}</span>
              <span className="text">{describeAction(a, { flow, nodeId: node.id })}</span>
              {a.risk === "unsafe" && <span className="pill warn" title="점검 실행이 누르지 않습니다">되돌릴 수 없음</span>}
              {(() => { const f = findings.find((x) => x.actionId === a.id); return f ? <span className={`pill ${f.status === "changed" ? "warn" : "bad"}`} title={f.differences.join(" · ")}>{f.status === "changed" ? "바뀜" : f.status === "missing" ? "없음" : "여러 개"}</span> : null; })()}
            </div>
            {open === a.id && (
              <div className="form">
                {(() => { const f = findings.find((x) => x.actionId === a.id); return f ? <FindingCard f={f} {...(onRepick ? { onRepick: () => onRepick(a.id) } : {})} /> : null; })()}
                <ActionForm flow={flow} nodeId={node.id} action={a} onChange={(na) => setActions((as) => as.map((x) => (x.id === a.id ? na : x)))} />
                <div className="row">
                  <button className="small" onClick={() => move(i, -1)} disabled={i === 0}>위로</button>
                  <button className="small" onClick={() => move(i, 1)} disabled={i === node.config.actions.length - 1}>아래로</button>
                  {/* 이 동작부터 새 노드(앞 페이지에서 이어서) — 맨 앞이면 주소로 시작할 때만(앞은 «페이지 접속»으로 남는다) */}
                  {onSplitAt && (i > 0 || start.kind !== "continue") && (
                    <button className="small" title={i === 0 ? "주소 열기만 «페이지 접속» 노드로 떼고, 이 동작부터 다음 노드로" : "이 동작부터 다음 노드로 나눕니다 — 같은 페이지에서 이어 돌고, 읽은 값도 이어집니다"} onClick={() => onSplitAt(i)}>여기서 나누기</button>
                  )}
                  <span className="grow" />
                  <button className="small danger" onClick={() => setActions((as) => as.filter((x) => x.id !== a.id))}>동작 지우기</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="row">
        <select value={addKind} onChange={(e) => setAddKind(e.target.value as WebAction["kind"])} style={{ width: 160 }}>
          {/* MetaMask 승인은 지갑 브라우저에서만 — 다른 브라우저에는 보이지 않게 */}
          {ACTION_KINDS.filter((k) => k !== "walletApprove" || flow.settings.browser === "wallet").map((k) => <option key={k} value={k}>{ACTION_LABEL[k]}</option>)}
        </select>
        <button onClick={() => {
          const a = newAction(addKind, node.config.actions.map((x) => x.id));
          setActions((as) => [...as, a]);
          setOpen(a.id);
        }}>＋ 동작 더하기</button>
      </div>
    </>
  );
}

function ActionForm({ flow, nodeId, action: a, onChange }: { flow: Flow; nodeId: string; action: WebAction; onChange: (a: WebAction) => void }) {
  const canBeOptional = a.kind !== "goto" && a.kind !== "wait" && a.kind !== "closeWindow" && a.kind !== "switchWindow" && a.kind !== "recheck" && a.kind !== "readTable" && a.kind !== "pickRow" && a.kind !== "human" && a.kind !== "walletApprove" && a.kind !== "save";
  const setWhen = (when: Rule | null) => { const { when: _drop, ...rest } = a; onChange((when ? { ...rest, when } : rest) as WebAction); };
  const common = (
    <>
    <label className="check"><input type="checkbox" checked={!!a.when} onChange={(e) => setWhen(e.target.checked ? { left: "", op: "eq", right: "" } : null)} />
      조건이 맞을 때만 — 안 맞으면 건너뜁니다(선물 포장이 「있음」일 때만 체크 같은 것)</label>
    {a.when && (() => {
      const w = a.when;
      return (
        <div className="stack" style={{ gap: 4, paddingLeft: 8, borderLeft: "2px solid var(--border)" }}>
          <TemplateInput flow={flow} nodeId={nodeId} value={w.left} placeholder="{{ $input.giftWrap }}" onChange={(left) => setWhen({ ...w, left })} />
          <select value={w.op} onChange={(e) => { const op = e.target.value as ConditionOp; setWhen({ ...w, op, right: UNARY_OPS.includes(op) ? null : (w.right ?? "") }); }}>
            {CONDITION_OPS.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
          </select>
          {w.right !== null && <TemplateInput flow={flow} nodeId={nodeId} value={w.right} placeholder="있음" onChange={(right) => setWhen({ ...w, right })} />}
        </div>
      );
    })()}
    {canBeOptional && (
      <label className="check"><input type="checkbox" checked={a.optional} onChange={(e) => onChange({ ...a, optional: e.target.checked })} />
        있을 때만 — 2초 안에 안 보이면 건너뜁니다(처음만 뜨는 안내창 같은 것)</label>
    )}
    {a.kind !== "human" && a.kind !== "walletApprove" && <div className="row">
      <label className="check grow"><input type="checkbox" checked={a.risk === "unsafe"} onChange={(e) => onChange({ ...a, risk: e.target.checked ? "unsafe" : "safe" })} />
        되돌릴 수 없는 동작(제출 · 저장 · 결제 등) — 점검 실행이 누르지 않습니다</label>
      <Field label="시간 제한(ms)">
        <input type="number" style={{ width: 100 }} value={a.timeoutMs ?? ""} placeholder="기본"
          onChange={(e) => onChange({ ...a, timeoutMs: e.target.value === "" ? null : Math.max(1, Number(e.target.value)) })} />
      </Field>
      {a.risk === "safe" && (
        <Field label="다시 해 보기(번)">
          <input type="number" min={0} max={5} style={{ width: 80 }} value={a.retries ?? ""} placeholder="설정대로"
            onChange={(e) => { const { retries: _drop, ...rest } = a; onChange((e.target.value === "" ? rest : { ...rest, retries: Math.max(0, Math.min(5, Number(e.target.value) || 0)) }) as WebAction); }} />
        </Field>
      )}
    </div>}
    </>
  );
  let body;
  switch (a.kind) {
    case "goto":
      body = <Field label="주소"><TemplateInput flow={flow} nodeId={nodeId} value={a.url} onChange={(url) => onChange({ ...a, url })} /></Field>;
      break;
    case "click":
      body = (
        <>
          <TargetEditor target={a.target} onChange={(target) => onChange({ ...a, target })} title="누를 것" />
          <label className="check"><input type="checkbox" checked={a.popup} onChange={(e) => onChange({ ...a, popup: e.target.checked })} />
            새 창(팝업)을 엽니다 — 그 창으로 옮겨 가서 뒤 동작을 합니다. 창이 닫히면 연 창으로 돌아옵니다</label>
          <div className="row wrap">
            <span className="small muted">브라우저 확인창</span>
            <select aria-label="브라우저 확인창" value={a.dialog ? (a.dialog.accept ? "accept" : "dismiss") : ""}
              onChange={(e) => {
                const { dialog: _drop, ...rest } = a;
                onChange(e.target.value === "" ? rest : { ...rest, dialog: { accept: e.target.value === "accept", expect: a.dialog?.expect ?? "" } });
              }}>
              <option value="">답하지 않음(뜨면 취소로 닫힘)</option>
              <option value="accept">«확인»으로 답한다</option>
              <option value="dismiss">«취소»로 답한다</option>
            </select>
            {a.dialog && (
              <input aria-label="확인창 문구" style={{ flex: 1, minWidth: 200 }} value={a.dialog.expect} placeholder="문구에 들어 있어야 할 글자 — 다르면 취소하고 멈춤"
                onChange={(e) => onChange({ ...a, dialog: { ...a.dialog!, expect: e.target.value } })} />
            )}
          </div>
        </>
      );
      break;
    case "closeWindow":
      body = <span className="small muted">팝업 창을 닫고 그 창을 연 창으로 돌아갑니다. 창 안의 «닫기» 단추를 눌렀다면 이 동작은 필요 없습니다.</span>;
      break;
    case "switchWindow":
      body = <span className="small muted">앞 동작들 끝에 열린 새 창으로 옮겨 가서 뒤 동작을 합니다 — 확인창에 답한 뒤 열리는 창처럼, 누르기와 바로 이어지지 않는 창에 씁니다(누르면 곧바로 열리는 창은 누르기의 «새 창을 엽니다»로). 창이 열릴 때까지 시간 제한만큼 기다리고, 창이 닫히면 연 창으로 돌아옵니다.</span>;
      break;
    case "recheck":
      body = <span className="small muted">이 노드에서 지금 창에 넣고 · 고르고 · 켠 칸을 다시 읽습니다. 지워졌거나 바뀐 칸은 한 번 다시 넣고, 그래도 안 맞으면 멈춥니다. 늦게 온 조회 결과가 넣은 칸을 지우는 화면에서 제출 · 계산 단추 바로 앞에 둡니다.</span>;
      break;
    case "pickRow": {
      const p = a.pick;
      const set = (patch: Partial<typeof p>) => onChange({ ...a, pick: { ...p, ...patch } });
      body = (
        <>
          <Field label="표 이름"><input value={p.label} onChange={(e) => set({ label: e.target.value })} /></Field>
          <TargetEditor target={p.rows} onChange={(rows) => set({ rows })} title="행 (여러 개가 정상)" />
          <div className="row wrap">
            <span className="small muted">찾는 법</span>
            <label className="check"><input type="radio" checked={p.by !== "index"} onChange={() => set({ by: "key" })} />값으로 — 키 칸의 글자</label>
            <label className="check"><input type="radio" checked={p.by === "index"} onChange={() => set({ by: "index", value: /^-?\d+$/.test(p.value.trim()) || p.value.includes("{{") ? p.value : "1" })} />몇 번째로 — 목록의 n번째</label>
          </div>
          {p.by !== "index" ? (
            <>
              <div className="row">
                <Field label="키 칸 이름"><input value={p.keyLabel} placeholder="주문번호" onChange={(e) => set({ keyLabel: e.target.value })} /></Field>
                <Field label="키 칸 — 행 안의 CSS"><input className="mono" value={p.keyColumn} placeholder="td:nth-child(2)" onChange={(e) => set({ keyColumn: e.target.value })} /></Field>
              </div>
              <Field label="찾을 값 — 키 칸의 글자가 이것과 같은 행을 고릅니다" hint="없거나 여러 개면 멈춥니다">
                <TemplateInput flow={flow} nodeId={nodeId} value={p.value} placeholder="{{ $params.orderNo }}" onChange={(value) => set({ value })} />
              </Field>
            </>
          ) : (
            <Field label="몇 번째 — 1부터 · 음수는 끝에서(-1은 마지막)" hint="그 자리에 행이 없으면 멈춥니다. 실행 입력으로 받으려면 ＋에서 고르세요">
              <TemplateInput flow={flow} nodeId={nodeId} value={p.value} placeholder="3 · -1 · {{ $params.n }}" onChange={(value) => set({ value })} />
            </Field>
          )}
          <Field label="행 안에서 누를 것(CSS) — 비우면 행을 누릅니다"><input className="mono" value={p.click} onChange={(e) => set({ click: e.target.value })} /></Field>
          <label className="check"><input type="checkbox" checked={p.refuse !== null} onChange={(e) => set({ refuse: e.target.checked ? { column: "", values: [], reason: "고르면 안 되는 행입니다" } : null })} />
            고르면 안 되는 행이 있습니다</label>
          {p.refuse && (() => {
            const r = p.refuse;
            return (
              <div className="row wrap">
                <Field label="볼 칸(CSS)"><input className="mono" value={r.column} placeholder="td:nth-child(5)" onChange={(e) => set({ refuse: { ...r, column: e.target.value } })} /></Field>
                <Field label="이 글자면 멈춤(쉼표로)"><input value={r.values.join(", ")} placeholder="배송완료" onChange={(e) => set({ refuse: { ...r, values: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) } })} /></Field>
                <Field label="이유"><input value={r.reason} onChange={(e) => set({ refuse: { ...r, reason: e.target.value } })} /></Field>
              </div>
            );
          })()}
        </>
      );
      break;
    }
    case "assert":
      body = (
        <>
          <TargetEditor target={a.target} onChange={(target) => onChange({ ...a, target })} title="볼 것" />
          <div className="row">
            <Field label="읽는 법">
              <select value={a.strategy} onChange={(e) => onChange({ ...a, strategy: e.target.value as typeof a.strategy })}>
                {READ_STRATEGIES.filter((x) => x !== "attribute").map((x) => <option key={x} value={x}>{READ_LABEL[x]}</option>)}
              </select>
            </Field>
          </div>
          <Field label="기대값 — 화면이 이것과 다르면 멈춥니다" hint="엉뚱한 건을 고쳐 쓰지 않게 — 예: 상세 화면의 주문번호가 찾던 번호인지">
            <TemplateInput flow={flow} nodeId={nodeId} value={a.equals} placeholder="{{ $params.orderNo }}" onChange={(equals) => onChange({ ...a, equals })} />
          </Field>
        </>
      );
      break;
    case "fill":
    case "select":
      body = (
        <>
          <TargetEditor target={a.target} onChange={(target) => onChange({ ...a, target })} title={a.kind === "fill" ? "넣을 칸" : "고를 칸"} />
          <Field label={a.kind === "fill" ? "넣을 값" : "고를 보기(보이는 이름 또는 값)"}>
            <TemplateInput flow={flow} nodeId={nodeId} secrets value={a.value} onChange={(value) => onChange({ ...a, value })} />
          </Field>
        </>
      );
      break;
    case "check":
      body = (
        <>
          <TargetEditor target={a.target} onChange={(target) => onChange({ ...a, target })} title="체크 칸" />
          <label className="check"><input type="checkbox" checked={a.checked} onChange={(e) => onChange({ ...a, checked: e.target.checked })} />켠 상태로</label>
        </>
      );
      break;
    case "press":
      body = (
        <>
          <Field label="키 (Enter · Tab · Escape · Control+A …)"><input value={a.key} onChange={(e) => onChange({ ...a, key: e.target.value })} /></Field>
          <label className="check"><input type="checkbox" checked={a.target !== null} onChange={(e) => onChange({ ...a, target: e.target.checked ? emptyTarget() : null })} />특정 요소에서 누르기</label>
          {a.target && <TargetEditor target={a.target} onChange={(target) => onChange({ ...a, target })} />}
        </>
      );
      break;
    case "wait":
      body = <WaitForm wait={a.wait} onChange={(wait) => onChange({ ...a, wait })} />;
      break;
    case "read":
      body = (
        <>
          <TargetEditor target={a.target} onChange={(target) => onChange({ ...a, target })} title="읽을 것" />
          <div className="row">
            <Field label="내보낼 이름"><input value={a.output} placeholder="status" onChange={(e) => onChange({ ...a, output: e.target.value })} /></Field>
            <Field label="읽는 법">
              <select value={a.strategy} onChange={(e) => {
                const strategy = e.target.value as typeof a.strategy;
                onChange({ ...a, strategy, attribute: strategy === "attribute" ? (a.attribute ?? "") : null });
              }}>
                {READ_STRATEGIES.map((s) => <option key={s} value={s}>{READ_LABEL[s]}</option>)}
              </select>
            </Field>
            {a.strategy === "attribute" && <Field label="속성"><input value={a.attribute ?? ""} onChange={(e) => onChange({ ...a, attribute: e.target.value })} /></Field>}
            <Field label="바꾸기">
              <select value={a.transform ?? ""} onChange={(e) => onChange({ ...a, transform: e.target.value === "number" ? "number" : null })}>
                <option value="">그대로(글자)</option>
                <option value="number">숫자로(「12,500원」→ 12500)</option>
              </select>
            </Field>
          </div>
        </>
      );
      break;
    case "human":
      body = <HumanForm action={a} onChange={onChange} />;
      break;
    case "walletApprove":
      body = <WalletApproveForm flow={flow} action={a} onChange={onChange} />;
      break;
    case "save":
      body = <SaveForm flow={flow} nodeId={nodeId} action={a} onChange={onChange} />;
      break;
    case "readTable":
      body = (
        <>
          <div className="row">
            <Field label="표 이름"><input value={a.table.label} onChange={(e) => onChange({ ...a, table: { ...a.table, label: e.target.value } })} /></Field>
            <Field label="내보낼 이름"><input value={a.output} onChange={(e) => onChange({ ...a, output: e.target.value })} /></Field>
            <Field label="최대 행"><input type="number" style={{ width: 80 }} value={a.table.maxRows} onChange={(e) => onChange({ ...a, table: { ...a.table, maxRows: Math.max(1, Number(e.target.value)) } })} /></Field>
          </div>
          <TargetEditor target={a.table.rows} onChange={(rows) => onChange({ ...a, table: { ...a.table, rows } })} title="행 (여러 개가 정상)" />
          <span className="small muted">열 — 행 안에서의 CSS 위치</span>
          {a.table.columns.map((c, i) => (
            <div key={i} className="row">
              <input placeholder="열 이름" value={c.name} onChange={(e) => onChange({ ...a, table: { ...a.table, columns: a.table.columns.map((x, j) => j === i ? { ...x, name: e.target.value } : x) } })} />
              <input className="mono" placeholder="td.name" value={c.selector} onChange={(e) => onChange({ ...a, table: { ...a.table, columns: a.table.columns.map((x, j) => j === i ? { ...x, selector: e.target.value } : x) } })} />
              <button className="small ghost" onClick={() => onChange({ ...a, table: { ...a.table, columns: a.table.columns.filter((_, j) => j !== i) } })}>✕</button>
            </div>
          ))}
          <button className="small" onClick={() => onChange({ ...a, table: { ...a.table, columns: [...a.table.columns, { name: "", selector: "", strategy: "auto" }] } })}>＋ 열</button>
          <label className="check"><input type="checkbox" checked={!!a.table.empty} onChange={(e) => { const { empty: _drop, ...rest } = a.table; onChange({ ...a, table: e.target.checked ? { ...rest, empty: emptyTarget() } : rest }); }} />
            빈 표 표시가 있습니다 — 「조회 결과가 없습니다」가 보이면 행을 기다리지 않고 빈 표로 끝냅니다</label>
          {a.table.empty && <TargetEditor target={a.table.empty} onChange={(empty) => onChange({ ...a, table: { ...a.table, empty } })} title="빈 표 표시" />}
          <Field label="스크롤 상자(CSS)" hint="보이는 행만 그리는 표일 때만 — 반 화면씩 내리며 읽어 잇습니다. 비우면 지금 그려진 행만 읽습니다">
            <input className="mono" placeholder="#grid .body" value={a.table.scroll ?? ""} onChange={(e) => { const { scroll: _drop, ...rest } = a.table; onChange({ ...a, table: e.target.value.trim() ? { ...rest, scroll: e.target.value } : rest }); }} />
          </Field>
        </>
      );
      break;
  }
  return <>{body}{common}</>;
}

const READ_LABEL: Record<(typeof READ_STRATEGIES)[number], string> = {
  auto: "알아서(칸이면 값, 아니면 글자)", value: "칸의 값", text: "글자(숨은 것 포함)", innerText: "보이는 글자", checked: "체크 여부", attribute: "속성", selected: "고른 보기의 이름", link: "링크 주소", html: "HTML 그대로(요소의 outerHTML)",
};
const WAIT_LABEL: Record<(typeof WAIT_KINDS)[number], string> = {
  fixed: "정해진 시간", visible: "요소가 보일 때까지", hidden: "요소가 사라질 때까지", url: "주소가 바뀔 때까지", networkIdle: "네트워크가 잠잠해질 때까지", filled: "칸에 값이 찰 때까지",
  stable: "값이 그대로일 때까지", changed: "값이 바뀔 때까지(같은 화면에서 다시 조회)",
};

const DONE_LABEL: Record<HumanDone["kind"], string> = { hidden: "이 요소가 사라지면(로그인 화면이 닫히면)", visible: "이 요소가 보이면(로그인 뒤 화면)", url: "주소가 이렇게 되면" };

/** 사람 기다리기 — 안내 문구 · 이 화면일 때만 · 끝났다는 표시 · 기다리는 시간(분) */
function HumanForm({ action: a, onChange }: { action: Extract<WebAction, { kind: "human" }>; onChange: (a: WebAction) => void }) {
  const minutes = Math.round((a.timeoutMs ?? HUMAN_TIMEOUT.defaultMs) / 6_000) / 10;
  return (
    <>
      <div className="banner info small">실행이 여기서 멈춰 사람을 기다립니다. 사람의 크롬이면 그 크롬 창에서, 앱 안 브라우저면 앞으로 나온 실행 창에서, 서버 브라우저면 «실제 화면 보기»에서 직접 합니다. 사람이 넣은 것(아이디 · 비밀번호)은 녹화하지도 기록하지도 않습니다.</div>
      <Field label="안내 문구 — 기다리는 동안 사람에게 보입니다">
        <input value={a.prompt} placeholder="포털에 로그인해 주세요" onChange={(e) => onChange({ ...a, prompt: e.target.value })} />
      </Field>
      <label className="check"><input type="checkbox" checked={a.appears !== null} onChange={(e) => onChange({ ...a, appears: e.target.checked ? emptyTarget() : null })} />
        이 화면일 때만 — 이 요소가 보일 때만 기다립니다(이미 로그인돼 있으면 건너뜁니다)</label>
      {a.appears && <TargetEditor target={a.appears} onChange={(appears) => onChange({ ...a, appears })} title="로그인 화면의 표시(예: 「로그인」 단추)" />}
      <DoneEditor done={a.done} onChange={(done) => onChange({ ...a, done })} />
      <Field label="기다리는 시간(분)" hint={`${HUMAN_TIMEOUT.minMs / 1000}초~${HUMAN_TIMEOUT.maxMs / 60_000}분 · 넘으면 실행이 실패합니다`}>
        <input type="number" min={0.5} max={30} step={0.5} style={{ width: 90 }} value={minutes}
          onChange={(e) => { const m = Number(e.target.value); onChange({ ...a, timeoutMs: Number.isFinite(m) && m > 0 ? Math.round(Math.min(HUMAN_TIMEOUT.maxMs, Math.max(HUMAN_TIMEOUT.minMs, m * 60_000))) : null }); }} />
      </Field>
    </>
  );
}

/** 끝났다는 표시 — 사람 기다리기 · MetaMask 승인이 함께 쓴다 */
function DoneEditor({ done, onChange, labels = DONE_LABEL }: { done: HumanDone; onChange: (d: HumanDone) => void; labels?: Record<HumanDone["kind"], string> }) {
  const setKind = (k: HumanDone["kind"]) => onChange(k === "url" ? { kind: k, pattern: done.kind === "url" ? done.pattern : "" } : { kind: k, target: done.kind === "url" ? emptyTarget() : done.target });
  return (
    <>
      <Field label="끝났다는 표시 — 이게 되면 다음 동작으로">
        <select value={done.kind} onChange={(e) => setKind(e.target.value as HumanDone["kind"])}>
          {(Object.keys(labels) as HumanDone["kind"][]).map((k) => <option key={k} value={k}>{labels[k]}</option>)}
        </select>
      </Field>
      {done.kind === "url"
        ? <Field label="주소 정규식" hint="예: /main 또는 portal\.example\.com/home"><input className="mono" value={done.pattern} onChange={(e) => onChange({ kind: "url", pattern: e.target.value })} /></Field>
        : <TargetEditor target={done.target} onChange={(target) => onChange({ ...done, target })} />}
    </>
  );
}

const WALLET_DONE_LABEL: Record<HumanDone["kind"], string> = { visible: "이 요소가 보이면(로그인 뒤 화면 — 지갑 주소 · 내 정보)", hidden: "이 요소가 사라지면(«지갑 연결» 단추가 사라지면)", url: "주소가 이렇게 되면" };

/** MetaMask 승인 — 끝났다는 표시 · 기다리는 시간(분) */
function WalletApproveForm({ flow, action: a, onChange }: { flow: Flow; action: Extract<WebAction, { kind: "walletApprove" }>; onChange: (a: WebAction) => void }) {
  const minutes = Math.round((a.timeoutMs ?? WALLET_APPROVE_TIMEOUT.defaultMs) / 6_000) / 10;
  return (
    <>
      {flow.settings.browser !== "wallet" && <div className="banner warn small">이 동작은 지갑 브라우저(MetaMask)에서만 돕니다 — 워크플로우 설정의 «브라우저»에서 고르세요</div>}
      <div className="banner info small">
        사이트의 «지갑 연결»을 누른 뒤에 둡니다. MetaMask 화면을 읽어 연결 · 로그인 서명은 누르고, 체인은 설정의 목록 안만, 거래는 «거래 허용»을 켠 체인만 누릅니다.
        모르는 화면은 누르지 않고 멈춥니다. 이미 끝났다는 표시가 보이면(연결돼 있으면) 아무것도 누르지 않고 지나갑니다.
      </div>
      <DoneEditor done={a.done} labels={WALLET_DONE_LABEL} onChange={(done) => onChange({ ...a, done })} />
      <label className="check">
        <input type="checkbox" checked={a.atLeast !== undefined} onChange={(e) => { const { atLeast: _old, ...rest } = a; onChange(e.target.checked ? { ...rest, atLeast: 1 } : rest); }} />
        지갑이 꼭 불려야 끝으로 칩니다 — 구매 · 등록처럼. 누른 단추가 처리 중으로 바뀌어 끝 표시가 먼저 맞아도, 승인 화면이 오기 전에는 끝내지 않습니다
      </label>
      {a.atLeast !== undefined && (
        <Field label="적어도 승인할 화면 수" hint="1~10 · 끝 표시가 와도 이만큼 승인하기 전에는 기다리고, 시간이 다 되면 «사이트가 지갑을 부르지 않았다»로 멈춥니다">
          <input type="number" min={1} max={10} style={{ width: 70 }} value={a.atLeast} onChange={(e) => onChange({ ...a, atLeast: Math.min(10, Math.max(1, Math.round(Number(e.target.value)) || 1)) })} />
        </Field>
      )}
      <Field label="기다리는 시간(분)" hint={`${WALLET_APPROVE_TIMEOUT.minMs / 1000}초~${WALLET_APPROVE_TIMEOUT.maxMs / 60_000}분 · 넘으면 실행이 실패합니다`}>
        <input type="number" min={0.5} max={10} step={0.5} style={{ width: 90 }} value={minutes}
          onChange={(e) => { const m = Number(e.target.value); onChange({ ...a, timeoutMs: Number.isFinite(m) && m > 0 ? Math.round(Math.min(WALLET_APPROVE_TIMEOUT.maxMs, Math.max(WALLET_APPROVE_TIMEOUT.minMs, m * 60_000))) : null }); }} />
      </Field>
    </>
  );
}

function WaitForm({ wait, onChange }: { wait: Wait; onChange: (w: Wait) => void }) {
  const setKind = (k: Wait["kind"]) => onChange(
    k === "fixed" ? { kind: k, ms: 1000 } : k === "stable" ? { kind: k, target: "target" in wait ? wait.target : emptyTarget(), ms: STABLE_WAIT.defaultMs }
      : k === "visible" || k === "hidden" || k === "filled" || k === "changed" ? { kind: k, target: "target" in wait ? wait.target : emptyTarget() } : k === "url" ? { kind: k, pattern: "" } : { kind: k },
  );
  return (
    <>
      <Field label="무엇을 기다리나">
        <select value={wait.kind} onChange={(e) => setKind(e.target.value as Wait["kind"])}>
          {WAIT_KINDS.map((k) => <option key={k} value={k}>{WAIT_LABEL[k]}</option>)}
        </select>
      </Field>
      {wait.kind === "fixed" && <Field label="ms"><input type="number" value={wait.ms} onChange={(e) => onChange({ kind: "fixed", ms: Math.max(1, Number(e.target.value)) })} /></Field>}
      {"target" in wait && <TargetEditor target={wait.target} onChange={(target) => onChange({ ...wait, target } as Wait)} />}
      {wait.kind === "stable" && (
        <Field label="그대로여야 하는 시간(초)" hint={`${STABLE_WAIT.minMs / 1000}~${STABLE_WAIT.maxMs / 1000}초 · 금액처럼 두 번 바뀌는 칸에서 중간값을 읽지 않게. 빈 값은 그대로여도 끝으로 치지 않습니다`}>
          <input type="number" min={STABLE_WAIT.minMs / 1000} max={STABLE_WAIT.maxMs / 1000} step={0.5} style={{ width: 80 }} value={wait.ms / 1000}
            onChange={(e) => { const s = Number(e.target.value); onChange({ ...wait, ms: Number.isFinite(s) ? Math.round(Math.min(STABLE_WAIT.maxMs, Math.max(STABLE_WAIT.minMs, s * 1000))) : STABLE_WAIT.defaultMs }); }} />
        </Field>
      )}
      {(wait.kind === "visible" || wait.kind === "hidden") && (
        <>
          <label className="check">
            <input type="checkbox" checked={wait.reloadEveryMs !== undefined} onChange={(e) => {
              const { reloadEveryMs: _old, ...rest } = wait;
              onChange(e.target.checked ? { ...rest, reloadEveryMs: 20_000 } : rest);
            }} />
            새로고침하며 기다리기 — 다른 실행 · 다른 사람이 바꾼 것이 화면에 저절로 오지 않을 때(올린 매물 · 거래 정산)
          </label>
          {wait.reloadEveryMs !== undefined && (
            <Field label="새로고침 간격(초)" hint={`${RELOAD_WAIT.minMs / 1000}초~${RELOAD_WAIT.maxMs / 60_000}분 · 다 기다리는 시간은 이 동작의 «시간 제한»(넉넉히 — 3분이면 180000ms)`}>
              <input type="number" min={RELOAD_WAIT.minMs / 1000} max={RELOAD_WAIT.maxMs / 1000} step={1} style={{ width: 80 }} value={wait.reloadEveryMs / 1000}
                onChange={(e) => { const sec = Number(e.target.value); onChange({ ...wait, reloadEveryMs: Number.isFinite(sec) ? Math.round(Math.min(RELOAD_WAIT.maxMs, Math.max(RELOAD_WAIT.minMs, sec * 1000))) : 20_000 }); }} />
            </Field>
          )}
        </>
      )}
      {wait.kind === "changed" && <span className="small muted">바로 앞 동작(조회 누르기 같은 것) 직전의 값과 달라지면, 그대로가 될 때까지 더 본 뒤 이어 갑니다. 앞 결과가 남아 있는 화면에서 묵은 값을 읽지 않게 합니다. 시간이 다 돼도 안 바뀌면 멈추지 않고 그 사실을 기록에 남깁니다.</span>}
      {wait.kind === "url" && <Field label="주소 정규식"><input className="mono" value={wait.pattern} onChange={(e) => onChange({ kind: "url", pattern: e.target.value })} /></Field>}
    </>
  );
}


/** 행마다 반복(PLAN §49) — 목록의 행마다 시작 주소 · 동작을 한 번씩, 한 브라우저 · 한 로그인으로 */
function EachEditor({ flow, node, update }: { flow: Flow; node: WebNode; update: Update<WebNode> }) {
  const each = node.config.each;
  const set = (next: WebNode["config"]["each"] | undefined) => update((n) => {
    const { each: _old, ...config } = n.config;
    return { ...n, config: next ? { ...config, each: next } : config };
  });
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={each !== undefined} onChange={(e) => set(e.target.checked ? { items: "{{ $input.rows }}", onError: "continue" } : undefined)} />
        행마다 반복 — 목록의 행마다 아래 일을 합니다(한 브라우저 · 한 로그인 · 주소로 시작하면 행마다 그 주소로). 행 안에서는 {"{{ $item.이름 }}"}이 그 행입니다
      </label>
      {each && (
        <div className="subcard stack" style={{ gap: 8 }}>
          <Field label="반복할 행들" hint="앞 노드가 낸 목록 — 예: {{ $input.pages }}. 출력은 rows(행마다 읽은 것 + ok · error) · succeeded · failed">
            <TemplateInput flow={flow} nodeId={node.id} value={each.items} placeholder="{{ $input.pages }}" onChange={(items) => set({ ...each, items })} />
          </Field>
          <Field label="한 행이 실패하면">
            <select value={each.onError} onChange={(e) => set({ ...each, onError: e.target.value as "stop" | "continue" })}>
              <option value="continue">그 행을 실패로 적고 다음 행으로</option>
              <option value="stop">노드를 멈춘다</option>
            </select>
          </Field>
        </div>
      )}
    </>
  );
}

/** 파일로 저장(PLAN §49) — 이 브라우저의 로그인으로 받아 이 워크플로우의 폴더에 */
function SaveForm({ flow, nodeId, action: a, onChange }: { flow: Flow; nodeId: string; action: Extract<WebAction, { kind: "save" }>; onChange: (a: WebAction) => void }) {
  return (
    <>
      <Field label="무엇을">
        <select value={a.source} onChange={(e) => {
          const source = e.target.value as typeof a.source;
          const { capture: _c, html: _h, ...rest } = a;
          onChange(source === "screenshot" ? { ...rest, source, capture: a.capture ?? { area: "full", target: null, format: "png", quality: null, mask: [] } }
            : source === "html" ? { ...rest, source, html: a.html ?? { area: "page", target: null } } : { ...rest, source });
        }}>
          <option value="url">주소에서 받기 — 이 브라우저의 로그인으로(PDF 내보내기 · 첨부)</option>
          <option value="page">지금 페이지를 PDF로 — 창 없는 브라우저에서만</option>
          <option value="screenshot">화면 캡처(PNG · JPEG) — 어느 브라우저에서나</option>
          <option value="html">HTML 추출 — 페이지 · 요소 하나</option>
        </select>
      </Field>
      {a.source === "screenshot" && a.capture && <CaptureFields c={a.capture} onChange={(capture) => onChange({ ...a, capture })} />}
      {a.source === "html" && a.html && (
        <>
          <Field label="무엇의 HTML">
            <select value={a.html.area} onChange={(e) => onChange({ ...a, html: e.target.value === "element" ? { area: "element", target: a.html!.target ?? emptyTarget() } : { area: "page", target: null } })}>
              <option value="page">페이지 전체 — 지금 그려진 그대로</option>
              <option value="element">요소 하나(본문만 같은 것)</option>
            </select>
          </Field>
          {a.html.area === "element" && <TargetEditor target={a.html.target ?? emptyTarget()} onChange={(target) => onChange({ ...a, html: { area: "element", target } })} />}
          <span className="small muted">따로 열어도 보이게 원래 주소(&lt;base&gt;)와 utf-8을 붙입니다. 값으로 넘기려면 «읽기»의 «HTML 그대로»를 쓰세요.</span>
        </>
      )}
      {a.source === "url" && (
        <Field label="받을 주소" hint="이 페이지 기준 상대 주소도 됩니다 — 화면은 옮기지 않습니다">
          <TemplateInput flow={flow} nodeId={nodeId} value={a.url} placeholder="/spaces/flyingpdf/pdfpageexport.action?pageId={{ $item.id }}" onChange={(url) => onChange({ ...a, url })} />
        </Field>
      )}
      {a.source === "url" && (
        <Field label="요청 머리(비워도 됨)" hint="한 줄에 «이름: 값» — 사이트의 요청 보호를 넘길 때(예: X-Atlassian-Token: no-check). 쿠키 · 인증은 넣지 않습니다(브라우저의 로그인을 씁니다)">
          <textarea className="mono" rows={2} value={Object.entries(a.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n")} placeholder="X-Atlassian-Token: no-check"
            onChange={(e) => {
              const headers = Object.fromEntries(e.target.value.split("\n").map((l) => l.split(/:(.*)/s)).filter((x) => x.length > 1 && x[0]!.trim() !== "").map(([k, v]) => [k!.trim(), (v ?? "").trim()]));
              const { headers: _old, ...rest } = a;
              onChange(Object.keys(headers).length ? { ...rest, headers } : rest);
            }} />
        </Field>
      )}
      <Field label="저장할 경로" hint="이 워크플로우의 폴더 아래 · 폴더는 만든다 · 파일 이름에 못 쓰는 글자는 바꾼다. .pdf면 받은 것이 정말 PDF인지 봅니다(로그인 화면이면 멈춤)">
        <TemplateInput flow={flow} nodeId={nodeId} value={a.path} placeholder="{{ $item.path }}.pdf" onChange={(path) => onChange({ ...a, path })} />
      </Field>
      <div className="row">
        <Field label="경로를 내보낼 이름(비워도 됨)"><input value={a.output ?? ""} onChange={(e) => onChange({ ...a, output: e.target.value.trim() === "" ? null : e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={a.skipExisting} onChange={(e) => onChange({ ...a, skipExisting: e.target.checked })} />이미 있으면 건너뛰기(끊긴 수집 이어 하기)</label>
      </div>
    </>
  );
}

/** 화면 캡처 — 범위 · 요소 · 형식 · 품질 · 가릴 요소(개인정보) */
function CaptureFields({ c, onChange }: { c: NonNullable<Extract<WebAction, { kind: "save" }>["capture"]>; onChange: (c: NonNullable<Extract<WebAction, { kind: "save" }>["capture"]>) => void }) {
  return (
    <>
      <div className="row wrap">
        <Field label="무엇을">
          <select value={c.area} onChange={(e) => { const area = e.target.value as typeof c.area; onChange({ ...c, area, target: area === "element" ? (c.target ?? emptyTarget()) : null }); }}>
            <option value="full">전체 페이지(스크롤 아래까지)</option>
            <option value="viewport">보이는 화면만</option>
            <option value="element">요소 하나</option>
          </select>
        </Field>
        <Field label="형식">
          <select value={c.format} onChange={(e) => onChange({ ...c, format: e.target.value as typeof c.format, quality: e.target.value === "jpeg" ? (c.quality ?? 80) : null })}>
            <option value="png">PNG — 글자가 또렷하다</option>
            <option value="jpeg">JPEG — 작다(긴 페이지)</option>
          </select>
        </Field>
        {c.format === "jpeg" && (
          <Field label="품질(1~100)">
            <input type="number" min={1} max={100} style={{ width: 70 }} value={c.quality ?? 80} onChange={(e) => onChange({ ...c, quality: Math.min(100, Math.max(1, Math.round(Number(e.target.value)) || 80)) })} />
          </Field>
        )}
      </div>
      {c.area === "element" && <TargetEditor target={c.target ?? emptyTarget()} onChange={(target) => onChange({ ...c, target })} />}
      <span className="small muted">가릴 요소 — 화면의 개인정보(이름 · 연락처 · 계좌)는 실행 기록처럼 저절로 가려지지 않습니다. 여기 고른 자리는 칠해서 찍습니다.</span>
      {c.mask.map((m, i) => (
        <div key={i} className="row">
          <div className="grow"><TargetEditor target={m} onChange={(t) => onChange({ ...c, mask: c.mask.map((x, j) => (j === i ? t : x)) })} /></div>
          <button className="icon-btn" title="빼기" onClick={() => onChange({ ...c, mask: c.mask.filter((_, j) => j !== i) })}><IconX size={14} /></button>
        </div>
      ))}
      <button className="btn small" style={{ alignSelf: "start" }} onClick={() => onChange({ ...c, mask: [...c.mask, emptyTarget()] })}>가릴 요소 더하기</button>
    </>
  );
}
