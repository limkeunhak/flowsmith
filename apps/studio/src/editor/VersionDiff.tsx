/**
 * **버전 비교** — 두 버전(또는 초안)이 무엇이 다른지 사람 말로(model/diff.ts). 게시하기 전에 «무엇이 바뀌었나»를 본다.
 */
import { useEffect, useState } from "react";
import type { Flow } from "@flowsmith/core";
import { api, type FlowDetail } from "../api.ts";
import { diffFlows, normalize, type Change } from "../model/index.ts";
import { IconX } from "../icons.tsx";

type Side = number | "draft";
const KIND_LABEL: Record<Change["kind"], string> = { added: "더함", removed: "뺌", changed: "바뀜" };

export function VersionDiff({ detail, draft, onClose }: { detail: FlowDetail; draft: Flow; onClose: () => void }) {
  const latest = detail.versions[0]?.version ?? null;
  const [left, setLeft] = useState<Side>(detail.activeVersion ?? latest ?? "draft");
  const [right, setRight] = useState<Side>("draft");
  const [flows, setFlows] = useState<Record<string, Flow>>({ draft });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    for (const s of [left, right]) {
      if (s === "draft" || flows[String(s)]) continue;
      api.getVersionJson(detail.id, s).then((j) => setFlows((f) => ({ ...f, [String(s)]: normalize(j) })), (e: Error) => setError(e.message));
    }
  }, [left, right]);   // eslint-disable-line react-hooks/exhaustive-deps

  const a = flows[String(left)];
  const b = flows[String(right)];
  const changes = a && b ? diffFlows(a, b) : null;
  const groups = new Map<string, Change[]>();
  for (const c of changes ?? []) groups.set(c.where, [...(groups.get(c.where) ?? []), c]);
  const label = (s: Side) => (s === "draft" ? "초안" : `v${s}${s === detail.activeVersion ? " (게시 중)" : ""}`);
  const options = (
    <>
      <option value="draft">초안</option>
      {detail.versions.map((v) => <option key={v.version} value={v.version}>{label(v.version)}{v.note ? ` — ${v.note}` : ""}</option>)}
    </>
  );
  const pick = (v: string): Side => (v === "draft" ? "draft" : Number(v));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal card diff-modal" role="dialog" aria-label="버전 비교">
        <div className="row"><h2 className="grow">버전 비교</h2><button className="icon-btn" title="닫기" onClick={onClose}><IconX /></button></div>
        <div className="row diff-pick">
          <select value={String(left)} onChange={(e) => setLeft(pick(e.target.value))} aria-label="예전">{options}</select>
          <span className="muted">→</span>
          <select value={String(right)} onChange={(e) => setRight(pick(e.target.value))} aria-label="지금">{options}</select>
        </div>
        {error && <div className="banner bad small">{error}</div>}
        {!changes ? <div className="empty">불러오는 중…</div>
          : changes.length === 0 ? <div className="empty-state"><b>바뀐 것이 없습니다</b><span>{label(left)}과(와) {label(right)}이(가) 같습니다(캔버스 위치는 세지 않습니다).</span></div>
          : (
            <div className="diff-list">
              <div className="small muted">{label(left)} → {label(right)} · 바뀐 것 {changes.length}개</div>
              {[...groups].map(([where, cs]) => (
                <div key={where} className="diff-group">
                  <b>{where}</b>
                  {cs.map((c, i) => <div key={i} className={`diff-row ${c.kind}`}><span className={`pill ${c.kind === "added" ? "ok" : c.kind === "removed" ? "bad" : "warn"}`}>{KIND_LABEL[c.kind]}</span><span className="grow">{c.text}</span></div>)}
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
