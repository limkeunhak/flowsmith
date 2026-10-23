/**
 * **승인을 기다리는 실행** — 대시보드 맨 위. 실행을 보고 있지 않은 사람(일정 · 웹훅 · 다른 사람이 돌린 실행)도 여기서 찾아 연다.
 * 승인 · 거절은 그 실행을 열어서 한다(무엇을 승인하는지 실행 기록을 보고).
 */
import { useEffect, useState } from "react";
import { ROLE_LABEL } from "@flowsmith/core";
import { api, type PendingApproval } from "../api.ts";
import { leftText } from "../live/RunScreen.tsx";
import { poll } from "../shell/poll.ts";

export function Approvals() {
  const [list, setList] = useState<PendingApproval[]>([]);
  useEffect(() => {
    const load = () => { void api.listApprovals().then(setList, () => undefined); };
    load();
    return poll(load, 10_000);
  }, []);
  if (list.length === 0) return null;
  return (
    <div className="banner warn dash-approvals" role="status">
      <b>🛡️ 승인을 기다리는 실행 {list.length}개</b>
      {list.map((a) => (
        <a key={a.runId} className="row small" href={`#/flows/${encodeURIComponent(a.flowId)}/runs/${encodeURIComponent(a.runId)}`}>
          <span className="grow">{a.flowName} — «{a.message}»</span>
          <span className="muted">{ROLE_LABEL[a.minRole]} 이상 · {leftText(a.deadline)} 남음</span>
        </a>
      ))}
    </div>
  );
}
