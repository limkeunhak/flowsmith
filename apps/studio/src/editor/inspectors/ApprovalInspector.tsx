/**
 * **승인 기다리기** 설정 — 무엇을 물을지(안내) · 누가 승인할 수 있나(역할) · 얼마나 기다리나.
 * 받은 값은 그대로 뒤로 넘기고 approved · by · comment · at을 더한다.
 */
import { APPROVAL_ROLES, APPROVAL_TIMEOUT, ROLE_LABEL, type ApprovalNode, type Flow } from "@flowsmith/core";
import { Field, TemplateInput } from "../widgets.tsx";

type Update = (fn: (n: ApprovalNode) => ApprovalNode) => void;

const PRESETS: { label: string; min: number }[] = [
  { label: "30분", min: 30 }, { label: "2시간", min: 120 }, { label: "하루", min: 24 * 60 }, { label: "사흘", min: 3 * 24 * 60 },
];
const minText = (m: number) => (m % (24 * 60) === 0 ? `${m / (24 * 60)}일` : m % 60 === 0 ? `${m / 60}시간` : `${m}분`);

export function ApprovalInspector({ flow, node, update }: { flow: Flow; node: ApprovalNode; update: Update }) {
  const c = node.config;
  const set = (patch: Partial<ApprovalNode["config"]>) => update((n) => ({ ...n, config: { ...n.config, ...patch } }));
  return (
    <>
      <Field label="승인할 사람에게 보일 안내">
        <TemplateInput flow={flow} nodeId={node.id} value={c.message} placeholder="{{ $input.orderNo }} 주문을 넣을까요?" onChange={(message) => set({ message })} />
      </Field>
      <span className="small muted">앞 노드의 값을 넣어 무엇을 승인하는지 알 수 있게 쓰세요(시크릿은 넣을 수 없습니다).</span>

      <Field label="누가 승인하나">
        <select value={c.minRole} onChange={(e) => set({ minRole: e.target.value as ApprovalNode["config"]["minRole"] })}>
          {APPROVAL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]} 이상</option>)}
        </select>
      </Field>
      <span className="small muted">이 워크플로우를 볼 수 있는 사람 중 이 역할 이상만 [승인] · [거절]을 누를 수 있습니다 — 실행자가 돌리고 편집자가 승인하게 할 수 있습니다.</span>

      <Field label={`기다리는 시간 — ${minText(c.timeoutMin)}`}>
        <div className="row wrap">
          <input type="number" min={APPROVAL_TIMEOUT.minMin} max={APPROVAL_TIMEOUT.maxMin} style={{ width: 100 }} value={c.timeoutMin} aria-label="분"
            onChange={(e) => set({ timeoutMin: Math.max(APPROVAL_TIMEOUT.minMin, Math.min(APPROVAL_TIMEOUT.maxMin, Math.round(Number(e.target.value)) || APPROVAL_TIMEOUT.minMin)) })} />
          <span className="small muted">분</span>
          <div className="chips">{PRESETS.map((p) => <button key={p.min} onClick={() => set({ timeoutMin: p.min })}>{p.label}</button>)}</div>
        </div>
      </Field>
      <span className="small muted">
        넘기면 이 노드가 실패해 실행이 멈춥니다. 거절해도 멈춥니다. 기다리는 동안 알림(«승인을 기다림»)이 가고, 실행 기록 · 편집 화면에 [승인] · [거절]이 뜹니다.
        내보내는 것: 받은 값 그대로 + <code>approved</code> · <code>by</code>(누가) · <code>comment</code>(한마디) · <code>at</code>. ★변경 감시(점검)는 이 노드 앞에서 멈춥니다.
      </span>
    </>
  );
}
