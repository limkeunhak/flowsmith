/**
 * 워커 목록을 함께 쓴다 — 워커 화면 · 플로우 설정(어디서 돌리나) · 실행 단추(이번만 어디서).
 * «어디서»는 「worker:<id>」 · 「label:<라벨>」 · null(서버) — 사람이 읽을 말로 바꾸는 것도 여기서.
 */
import { useEffect, useState } from "react";
import { api, type WorkersView } from "../api.ts";
import { poll } from "./poll.ts";
import { recall, remember } from "./remember.ts";

/** active일 때 불러오고, pollMs가 있으면 그 간격으로 다시 (워커 화면은 연결 상태를 따라간다). again이 바뀌면 바로 다시 */
export function useWorkers(active = true, pollMs?: number, again = 0): WorkersView | null {
  const [v, setV] = useState<WorkersView | null>(null);
  useEffect(() => {
    if (!active) return;
    let gone = false;
    const load = () => api.listWorkers().then((x) => { if (!gone) setV(x); }, () => undefined);
    void load();
    const stop = pollMs ? poll(load, pollMs) : null;
    return () => { gone = true; stop?.(); };
  }, [active, pollMs, again]);
  return v;
}

const RECORD_ON = "flowsmith:record-on";
/**
 * 녹화할 PC — 이 브라우저(= 이 사람의 PC)가 기억한다. 「worker:<id>」 · 없으면 서버.
 * ★사람의 크롬에 붙는 플로우만 쓴다 — 그 크롬이 있는 PC여야 한다
 */
export const rememberedRecordOn = (): string | null => recall(RECORD_ON);
export const rememberRecordOn = (on: string | null): void => remember(RECORD_ON, on || null);

/** «어디서»를 말로 — 서버 · «김담당 PC» · 라벨 관리자화면 */
export function placeLabel(on: string | null | undefined, v: WorkersView | null): string {
  if (!on || on === "server") return "서버";
  if (on.startsWith("label:")) return `라벨 ${on.slice(6)}`;
  if (on.startsWith("worker:")) return `«${v?.workers.find((w) => `worker:${w.id}` === on)?.name ?? "지워진 워커"}»`;
  return on;
}
