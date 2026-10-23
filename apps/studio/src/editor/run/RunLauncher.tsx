/**
 * 캔버스 아래 가운데의 실행 버튼 (n8n의 「Test workflow」 자리).
 * 실행 입력이 있으면 위로 작은 창이 열려 받는다. 지난번 입력은 이 브라우저에 기억한다(편의).
 */
import { useEffect, useRef, useState } from "react";
import { paramProblem, type Flow } from "@flowsmith/core";
import { ParamInput } from "../widgets.tsx";
import type { FlowDetail } from "../../api.ts";
import { placeLabel, useWorkers } from "../../shell/workers.ts";
import { IconChevronUp, IconPlay } from "../../icons.tsx";
import type { RunTarget } from "./useRun.ts";
import { recallParams, rememberParams } from "../../shell/remember.ts";


/** onlyPublished — 실행자(편집자 아래): 초안은 못 돌린다 · 게시된 버전만 */
export function RunLauncher({ flow, detail, running, error, onRun, onlyPublished = false }: {
  flow: Flow; detail: FlowDetail; running: boolean; error: string[] | null;
  /** on — 이번만 어디서(없으면 플로우 설정대로) */
  onRun: (target: RunTarget, params: Record<string, string>, on?: string) => Promise<boolean>;
  onlyPublished?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<RunTarget>(onlyPublished ? "active" : "draft");
  const [params, setParams] = useState<Record<string, string>>(() => recallParams(flow.id));
  const box = useRef<HTMLDivElement>(null);
  // 어디서 — 워커가 하나라도 있을 때만 고르게 한다(없으면 늘 서버)
  const workers = useWorkers(open);
  const [on, setOn] = useState("");

  useEffect(() => { if (error) setOpen(true); }, [error]);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    addEventListener("mousedown", on);
    return () => removeEventListener("mousedown", on);
  }, [open]);

  // 필수인데 비었고 기본값도 없음 · 종류가 안 맞음 — 창을 열어 보여 준다
  const missing = flow.params.filter((p) => (p.required && (params[p.name] ?? "").trim() === "" && p.default === "") || ((params[p.name] ?? "").trim() !== "" && paramProblem(p, params[p.name]!)));
  const go = async () => {
    if (missing.length > 0) { setOpen(true); return; }
    rememberParams(flow.id, params);
    if (await onRun(target, params, on || undefined)) setOpen(false);
  };
  const targetLabel = (target === "draft" ? "초안" : target === "active" ? `배포 v${detail.activeVersion}` : `v${target}`) + (on ? ` · ${placeLabel(on, workers)}` : "");

  return (
    <div className="launcher" ref={box}>
      {open && (
        <div className="launcher-pop">
          <label className="field"><span>무엇을 돌리나</span>
            <select value={String(target)} onChange={(e) => setTarget(e.target.value === "draft" || e.target.value === "active" ? e.target.value : Number(e.target.value))}>
              <option value="draft">초안 (저장하고 돌립니다)</option>
              {detail.activeVersion !== null && <option value="active">배포된 버전 v{detail.activeVersion}</option>}
              {detail.versions.map((v) => <option key={v.version} value={v.version}>v{v.version}{v.note ? ` — ${v.note}` : ""}</option>)}
            </select>
          </label>
          {workers && workers.workers.length > 0 && (
            <label className="field"><span>실행 위치 <em className="hint">이번만</em></span>
              <select value={on} onChange={(e) => setOn(e.target.value)}>
                <option value="">기본 — {placeLabel(detail.runOn ?? null, workers)}</option>
                <option value="server">서버</option>
                <optgroup label="워커">
                  {workers.workers.map((w) => <option key={w.id} value={`worker:${w.id}`} disabled={!w.online || !w.enabled}>{w.name} — {!w.enabled ? "잠시 끔" : w.online ? `연결됨 · ${w.running.length}/${w.slots}` : "꺼짐"}</option>)}
                </optgroup>
                {workers.labels.length > 0 && <optgroup label="라벨 (비어 있는 워커)">
                  {workers.labels.map((l) => <option key={l} value={`label:${l}`}>라벨 {l}</option>)}
                </optgroup>}
              </select>
            </label>
          )}
          {flow.params.map((p) => (
            <ParamInput key={p.name} def={p} value={params[p.name] ?? ""} onChange={(v) => setParams((x) => ({ ...x, [p.name]: v }))} onEnter={() => void go()} />
          ))}
          {error && <div className="banner bad small">{error.map((x, i) => <div key={i}>{x}</div>)}</div>}
        </div>
      )}
      <div className="launcher-bar">
        <button className="run-btn" disabled={running} onClick={() => void go()}>
          {running ? <span className="spinner" /> : <IconPlay size={14} />}
          {running ? "도는 중…" : `워크플로우 실행 · ${targetLabel}`}
        </button>
        <button className="run-more" title="실행 입력 · 버전 고르기" onClick={() => setOpen(!open)}><IconChevronUp size={16} /></button>
      </div>
    </div>
  );
}
