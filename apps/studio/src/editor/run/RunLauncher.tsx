/**
 * 공정 바 — 캔버스 아래에 붙은 막대(작업대 · 2026-10-27). 실행 단추(불씨) · 단계 트랙(01-02-03 … 지금 실행의 상태) · 지난 실행 · 모든 실행(실행 기록 탭으로).
 * 실행 입력이 있으면 위로 작은 창이 열려 받는다. 지난번 입력은 이 브라우저에 기억한다(편의).
 * **«내 PC에서 실행하기»**(PLAN §44 · 4단계) — 내 개인 워커에서 돌려 눈으로 본다. 끄면 워크플로우 설정대로(공용 워커 · 서버).
 *  데스크톱 앱(회사 서버 모드)이면 이 앱 — 앱 안 · 지갑 브라우저 워크플로우는 화면이 있어야 해서 늘 켜짐.
 *  웹이면 내가 주인인 개인 워커(내 PC의 워커 프로그램 · 앱)가 있을 때만 — 여럿이면 고른다(shell/workers.ts useMyPcs).
 */
import { useEffect, useRef, useState } from "react";
import { paramProblem, type Flow } from "@flowsmith/core";
import { ParamInput } from "../widgets.tsx";
import type { FlowDetail, NodeStatus, RunRow } from "../../api.ts";
import { ago } from "../../format.ts";
import { placeLabel, useWorkers } from "../../shell/workers.ts";
import { IconChevronUp, IconPlay } from "../../icons.tsx";
import type { RunTarget } from "./useRun.ts";
import { recallParams, rememberParams } from "../../shell/remember.ts";
import { pcCannot, useMyPcs } from "../../shell/workers.ts";

const MINE_KEY = "flowsmith.runMine";
const readMine = (): boolean => { try { return localStorage.getItem(MINE_KEY) === "1"; } catch { return false; } };
const writeMine = (on: boolean) => { try { localStorage.setItem(MINE_KEY, on ? "1" : "0"); } catch { /* 기억은 편의 */ } };


/** onlyPublished — 실행자(편집자 아래): 초안은 못 돌린다 · 게시된 버전만 */
/** 공정 트랙의 한 칸 — no는 캔버스 카드의 번호와 같다 */
export interface TrackStep { id: string; no: number; name: string; status: NodeStatus | null }

const RUN_LABEL: Record<RunRow["status"], string> = { running: "도는 중", success: "성공", failure: "실패", cancelled: "멈춤", blocked: "막힘" };

export function RunLauncher({ flow, detail, running, error, onRun, onlyPublished = false, steps, last, onHistory }: {
  flow: Flow; detail: FlowDetail; running: boolean; error: string[] | null;
  /** 단계 트랙 — 번호 순서 · 지금(또는 막 끝난) 실행의 상태 */
  steps: TrackStep[];
  /** 지난 실행 한 줄 — 없으면 «아직 돌리지 않았습니다» */
  last: RunRow | null;
  onHistory: () => void;
  /** on — 이번만 어디서(없으면 플로우 설정대로) · resetWallet — 지갑을 다시 준비하고 돈다(지갑 브라우저) */
  onRun: (target: RunTarget, params: Record<string, string>, opts?: { on?: string; resetWallet?: boolean }) => Promise<boolean>;
  onlyPublished?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<RunTarget>(onlyPublished ? "active" : "draft");
  const [params, setParams] = useState<Record<string, string>>(() => recallParams(flow.id));
  const box = useRef<HTMLDivElement>(null);
  // 어디서 — 워커가 하나라도 있을 때만 고르게 한다(없으면 늘 서버)
  const workers = useWorkers(open);
  const [on, setOn] = useState("");
  /** 지갑 브라우저 — 이번만 지갑 프로필을 지우고 처음부터 준비한다(한 번 쓰면 다시 끈다) */
  const [resetWallet, setResetWallet] = useState(false);
  // 내 PC — 데스크톱 앱(회사 서버 모드)일 때만. 화면이 있어야 하는 워크플로우는 늘 켠다
  const pcs = useMyPcs();
  const [pcId, setPcId] = useState<string | null>(null);
  const pc = pcs.find((p) => p.id === pcId) ?? pcs.find((p) => p.online) ?? pcs[0] ?? null;
  const needsScreen = pc?.here === true && (flow.settings.browser === "app" || flow.settings.browser === "wallet");
  const [mineWanted, setMineWanted] = useState(readMine);
  const mine = pc !== null && (needsScreen || mineWanted);
  const cannot = pc && mine ? pcCannot(pc, flow.settings.browser) : null;

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
    const wantReset = resetWallet && flow.settings.browser === "wallet";
    const where = mine && pc ? `worker:${pc.id}` : on;
    if (await onRun(target, params, { ...(where ? { on: where } : {}), ...(wantReset ? { resetWallet: true } : {}) })) { setOpen(false); setResetWallet(false); }
  };
  const targetLabel = (target === "draft" ? "초안" : target === "active" ? `배포 v${detail.activeVersion}` : `v${target}`) + (mine ? " · 내 PC" : on ? ` · ${placeLabel(on, workers)}` : "") + (resetWallet && flow.settings.browser === "wallet" ? " · 지갑 다시 준비" : "");
  const shared = workers?.workers.filter((w) => w.kind !== "personal") ?? [];

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
          {!mine && workers && shared.length > 0 && (
            <label className="field"><span>실행 위치 <em className="hint">이번만</em></span>
              <select value={on} onChange={(e) => setOn(e.target.value)}>
                <option value="">기본 — {placeLabel(detail.runOn ?? null, workers)}</option>
                <option value="server">서버</option>
                <optgroup label="워커">
                  {shared.map((w) => <option key={w.id} value={`worker:${w.id}`} disabled={!w.online || !w.enabled}>{w.name} — {!w.enabled ? "잠시 끔" : w.online ? `연결됨 · ${w.running.length}/${w.slots}` : "꺼짐"}</option>)}
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
          {flow.settings.browser === "wallet" && (
            <label className="check small" title="MetaMask가 잠금을 풀지 못하거나 화면이 이상할 때 — 그 PC에 있는 이 지갑의 프로필을 지우고 처음부터 준비합니다(30초쯤). 이메일 재인증 같은 사람 몫은 다시 해야 합니다">
              <input type="checkbox" checked={resetWallet} onChange={(e) => setResetWallet(e.target.checked)} />
              지갑 다시 준비 — 이번 실행은 MetaMask 프로필을 지우고 처음부터
            </label>
          )}
          {error && <div className="banner bad small">{error.map((x, i) => <div key={i}>{x}</div>)}</div>}
        </div>
      )}
      <div className="launcher-bar">
        {pc && (
          <label className={`run-mine${mine ? " on" : ""}`} title={cannot ?? (needsScreen ? "화면이 있어야 하는 워크플로우(앱 안 · 지갑 브라우저)라 늘 이 PC에서 돕니다"
            : !pc.online ? `«${pc.name}»가 연결돼 있지 않습니다(${pc.state}) — 그 PC에서 ${pc.here ? "앱" : "워커 프로그램"}을 켜세요`
            : pc.here ? `«${pc.name}»(이 PC)에서 돌려 실행 창으로 봅니다. 끄면 워크플로우 설정대로(공용 워커 · 서버)`
            : `«${pc.name}»(내 개인 워커)에서 돌립니다 — 그 PC에 창이 뜨면 거기서, 아니면 «실제 화면 보기»로 봅니다. 끄면 워크플로우 설정대로`)}>
            <input type="checkbox" checked={mine} disabled={needsScreen} onChange={(e) => { setMineWanted(e.target.checked); writeMine(e.target.checked); }} />
            내 PC에서 실행하기{mine && !pc.online ? " · 연결 안 됨" : mine && cannot ? " · 못 돌림" : ""}
            {mine && pcs.length > 1 && (
              <select value={pc.id} aria-label="내 PC 고르기" onClick={(e) => e.stopPropagation()} onChange={(e) => setPcId(e.target.value)}>
                {pcs.map((p) => <option key={p.id} value={p.id}>{p.name}{p.online ? "" : " — 꺼짐"}</option>)}
              </select>
            )}
          </label>
        )}
        <button className="run-btn" disabled={running || (mine && pc !== null && (!pc.online || cannot !== null))} onClick={() => void go()}>
          {running ? <span className="spinner" /> : <IconPlay size={14} />}
          {running ? "도는 중…" : `워크플로우 실행 · ${targetLabel}`}
        </button>
        <button className="run-more" title="실행 입력 · 버전 고르기" onClick={() => setOpen(!open)}><IconChevronUp size={16} /></button>
      </div>
      {steps.length > 0 && (
        <ol className="launcher-track" aria-label="단계 트랙">
          {steps.map((st) => (
            <li key={st.id} className={`track-step${st.status ? ` st-${st.status}` : ""}`} title={`${String(st.no).padStart(2, "0")} ${st.name}${st.status ? ` — ${TRACK_LABEL[st.status]}` : ""}`}>
              {String(st.no).padStart(2, "0")}
            </li>
          ))}
        </ol>
      )}
      <span className="launcher-last">
        {last ? <>지난 실행 · {ago(last.startedAt)} · <b className={`st-${last.status}`}>{RUN_LABEL[last.status]}</b>{last.ms !== null ? ` · ${(last.ms / 1000).toFixed(1)}초` : ""}</> : "아직 돌리지 않았습니다"}
      </span>
      <span className="grow" />
      <button type="button" className="ghost launcher-history" onClick={onHistory}>모든 실행 보기 →</button>
    </div>
  );
}

const TRACK_LABEL: Record<NodeStatus, string> = { pending: "기다림", running: "도는 중", succeeded: "성공", failed: "실패", skipped: "건너뜀", cancelled: "멈춤", blocked: "막힘" };
