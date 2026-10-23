/**
 * **변경 감시** 화면 — 위쪽 배너 · 서랍의 감시 패널 (PLAN §6).
 *
 * 무엇이 어떻게 달라졌나(녹화 때 / 지금)와 후보를 보이고, [다시 지정]으로 레코더를 그 동작 앞까지 재생해 연다.
 * ★고치는 건 사람이다(결정 3). 후보를 자동으로 쓰지 않는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Flow, Fingerprint, ProbeFinding } from "@flowsmith/core";
import { api, ApiError, type ProbeRow } from "../../api.ts";
import { describeLocator } from "../../model/index.ts";
import { IconAlert, IconCheck, IconX } from "../../icons.tsx";
import { PROBE_STATUS_LABEL } from "@flowsmith/core";
import { dateTime } from "../../format.ts";

const FINDING_TEXT: Record<ProbeFinding["status"], string> = { ok: "그대로", changed: "바뀜", missing: "없음", many: "여러 개" };
export const statusPill = (s: ProbeRow["status"] | ProbeFinding["status"]) =>
  s === "ok" ? "ok" : s === "changed" ? "warn" : s === "running" ? "accent" : "bad";

export function useMonitor(flowId: string, onToast: (t: string) => void) {
  const [probes, setProbes] = useState<ProbeRow[]>([]);
  const [running, setRunning] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const reload = useCallback(() => api.listProbes(flowId).then(setProbes, () => undefined), [flowId]);
  useEffect(() => { void reload(); return () => clearTimeout(timer.current); }, [reload]);

  const start = useCallback(async (version?: number | "draft") => {
    try {
      const { probeId } = await api.startProbe(flowId, version);
      setRunning(true);
      const poll = async () => {
        const p = await api.getProbe(probeId).catch(() => null);
        if (p && p.status !== "running") { setRunning(false); void reload(); onToast(`점검 끝 — ${PROBE_STATUS_LABEL[p.status]}${p.report?.message ? ` · ${p.report.message}` : ""}`); return; }
        timer.current = window.setTimeout(() => void poll(), 1500);
      };
      void reload();
      timer.current = window.setTimeout(() => void poll(), 1000);
    } catch (e) {
      onToast(e instanceof ApiError ? e.message : String(e));
    }
  }, [flowId, reload, onToast]);

  const latest = probes.find((p) => p.status !== "running") ?? null;
  // 노드마다 가장 나쁜 것 — 캔버스 배지
  const drift = useMemo(() => {
    const m = new Map<string, "changed" | "broken">();
    if (latest && latest.status !== "ok") for (const f of latest.report?.findings ?? []) {
      if (f.status === "ok") continue;
      m.set(f.nodeId, f.status === "changed" && m.get(f.nodeId) !== "broken" ? "changed" : "broken");
    }
    return m;
  }, [latest]);
  const findingsFor = useCallback((nodeId: string) => (latest && latest.status !== "ok" ? (latest.report?.findings ?? []).filter((f) => f.nodeId === nodeId && f.status !== "ok") : []), [latest]);
  return { probes, latest, running, start, reload, drift, findingsFor };
}

/** 위쪽 배너 — 바뀜 · 깨짐 · 점검 못 함일 때만 */
export function DriftBanner({ latest, running, onOpen, onProbe }: { latest: ProbeRow | null; running: boolean; onOpen: () => void; onProbe: () => void }) {
  if (!latest || latest.status === "ok") return null;
  const bad = latest.status === "broken" || latest.status === "error";
  return (
    <div className={`drift-banner ${bad ? "bad" : "warn"}`}>
      <IconAlert size={16} />
      <strong>{latest.status === "error" ? "변경 감시를 못 했습니다" : "사이트가 바뀐 것 같습니다"}</strong>
      <span className="grow">{latest.report?.message ?? ""} · {latest.source === "run" ? "실행이 멈춰 확인 점검" : "점검"} {dateTime(latest.at)}</span>
      <button className="small" onClick={onOpen}>자세히</button>
      <button className="small" disabled={running} onClick={onProbe}>{running ? "점검 중…" : "다시 점검"}</button>
    </div>
  );
}

function FingerprintLine({ fp }: { fp: Fingerprint | null }) {
  if (!fp) return <span className="muted">—</span>;
  const id = fp.attrs["id"] ? `#${fp.attrs["id"]}` : "";
  return <span className="mono small">&lt;{fp.tag}{id}&gt; {fp.text ? `'${fp.text.slice(0, 30)}'` : ""}{fp.nearText ? ` · 이름표 '${fp.nearText.slice(0, 20)}'` : ""}</span>;
}

export function FindingCard({ f, nodeName, onOpenNode, onRepick }: { f: ProbeFinding; nodeName?: string; onOpenNode?: () => void; onRepick?: () => void }) {
  return (
    <div className={`finding st-${f.status}`}>
      <div className="row">
        <span className={`pill ${statusPill(f.status)}`}>{FINDING_TEXT[f.status]}</span>
        <strong className="grow">{f.label}</strong>
        {nodeName && onOpenNode && <a href="#" onClick={(e) => { e.preventDefault(); onOpenNode(); }}>{nodeName}</a>}
      </div>
      {f.differences.length > 0 && <ul className="diffs">{f.differences.map((d, i) => <li key={i}>{d}</li>)}</ul>}
      <dl>
        <dt>위치</dt><dd className="mono small">{describeLocator(f.locator)} → 지금 {f.count}개</dd>
        <dt>녹화 때</dt><dd><FingerprintLine fp={f.before} /></dd>
        <dt>지금</dt><dd><FingerprintLine fp={f.now} /></dd>
        {f.candidates.length > 0 && <><dt>후보</dt><dd>{f.candidates.map((c, i) => <div key={i} className="mono small">{describeLocator(c.locator)} → {c.count < 0 ? "확인 못 함" : `${c.count}개`}</div>)}</dd></>}
      </dl>
      {onRepick && <div className="row"><span className="grow small muted">후보는 자동으로 쓰지 않습니다</span><button className="small primary" onClick={onRepick}>다시 지정</button></div>}
    </div>
  );
}

export function MonitorPanel({ flow, activeVersion, monitor, onClose, onOpenNode, onRepick }: {
  flow: Flow; activeVersion: number | null;
  monitor: ReturnType<typeof useMonitor>;
  onClose: () => void; onOpenNode: (id: string) => void; onRepick: (nodeId: string, actionId: string) => void;
}) {
  const { latest, probes, running, start } = monitor;
  const findings = latest?.report?.findings ?? [];
  const bad = findings.filter((f) => f.status !== "ok");
  const nodeName = (id: string) => flow.nodes.find((n) => n.id === id)?.name ?? id;
  const isWeb = (id: string) => flow.nodes.find((n) => n.id === id)?.type === "web";
  const every = flow.settings.monitorIntervalMin;
  return (
    <div className="drawer-inner">
      <div className="drawer-head"><IconAlert /><h2 className="grow">변경 감시</h2><button className="icon-btn" onClick={onClose}><IconX /></button></div>
      <div className="drawer-body stack">
        <div className="small muted">
          {flow.settings.browser === "attach" ? "사람의 크롬에 붙는 워크플로우라 주기 감시는 하지 않습니다 — «지금 점검»만 됩니다."
            : every === null ? "주기 감시가 꺼져 있습니다 — 워크플로우 설정에서 주기(분)를 정하면 게시된 버전을 그 간격으로 점검합니다."
            : activeVersion === null ? `게시하면 ${every}분마다 점검합니다.` : `게시된 v${activeVersion}을 ${every}분마다 점검합니다.`}
          {" "}점검은 «점검용 입력값»으로 돌고, 되돌릴 수 없는 동작은 누르지 않습니다.
        </div>
        <div className="row">
          <button className="primary" disabled={running} onClick={() => void start(activeVersion ?? "draft")}>{running ? "점검 중…" : `지금 점검 (${activeVersion !== null ? `v${activeVersion}` : "초안"})`}</button>
          {activeVersion !== null && <button disabled={running} onClick={() => void start("draft")}>초안으로 점검</button>}
        </div>

        {latest ? (
          <div className="subcard">
            <div className="row">
              <span className={`pill ${statusPill(latest.status)}`}>{latest.status === "ok" ? <IconCheck size={12} /> : <IconAlert size={12} />} {PROBE_STATUS_LABEL[latest.status]}</span>
              <span className="grow small muted">{latest.source === "run" ? "실행이 멈춰 확인 점검" : `점검 · ${latest.version === null ? "초안" : `v${latest.version}`}`} · {dateTime(latest.at)}</span>
            </div>
            <div>{latest.report?.message}</div>
            {latest.report?.stop.reason && <div className="small muted">멈춘 곳: {latest.report.stop.nodeId ? `${nodeName(latest.report.stop.nodeId)} — ` : ""}{latest.report.stop.reason}</div>}
          </div>
        ) : <div className="empty small">아직 점검한 적이 없습니다</div>}

        {bad.map((f, i) => (
          <FindingCard key={i} f={f} nodeName={nodeName(f.nodeId)} onOpenNode={() => onOpenNode(f.nodeId)}
            {...(isWeb(f.nodeId) && f.actionId ? { onRepick: () => onRepick(f.nodeId, f.actionId) } : {})} />
        ))}
        {findings.length > bad.length && <div className="small muted">그대로인 요소 {findings.length - bad.length}개</div>}

        {probes.length > 1 && (
          <>
            <h3>지난 점검</h3>
            <div className="stack" style={{ gap: 4 }}>
              {probes.slice(0, 10).map((p) => (
                <div key={p.id} className="row small">
                  <span className={`pill ${statusPill(p.status)}`}>{PROBE_STATUS_LABEL[p.status]}</span>
                  <span className="muted">{p.source === "run" ? "실행" : "점검"}</span>
                  <span className="grow muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.report?.message ?? ""}</span>
                  <span className="muted">{dateTime(p.at)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
