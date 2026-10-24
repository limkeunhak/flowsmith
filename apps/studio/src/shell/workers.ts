/**
 * 워커 목록을 함께 쓴다 — 워커 화면 · 플로우 설정(어디서 돌리나) · 실행 단추(이번만 어디서).
 * «어디서»는 「worker:<id>」 · 「label:<라벨>」 · null(서버) — 사람이 읽을 말로 바꾸는 것도 여기서.
 */
import { useEffect, useState } from "react";
import { api, type WorkersView } from "../api.ts";
import { myPc, useDesktop } from "../live/desktop.ts";
import { useMe } from "./me.ts";
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

/**
 * **내 PC**(«내 PC에서 실행하기» · 녹화할 곳) — 개인 워커(PLAN §44 · 4단계) 가운데 지금 나의 것.
 *   데스크톱 앱(회사 서버 모드)에서 열었으면 **이 앱**(here) 하나 — 앱이 자기 워커 id를 알려 준다.
 *   웹에서 열었으면 **로그인한 내가 주인인 개인 워커들** — 웹 페이지는 자기가 어느 PC인지 모르니, 내 PC에 켜 둔 워커 프로그램 · 앱을 고른다.
 * capabilities — 그 PC가 할 수 있는 일(app: 앱 안 브라우저 · wallet: 지갑 브라우저)
 */
export interface MyPc { id: string; name: string; online: boolean; state: string; capabilities: string[]; here: boolean }

export function useMyPcs(): MyPc[] {
  const desk = myPc(useDesktop());
  const me = useMe();
  const v = useWorkers(desk === null && me.auth && me.user !== null, 10_000);
  if (desk) return [{ ...desk, capabilities: ["app", "wallet"], here: true }];
  const email = me.user?.email.toLowerCase();
  if (!email) return [];
  return (v?.workers ?? [])
    .filter((w) => w.kind === "personal" && w.owner?.toLowerCase() === email)
    .map((w) => ({ id: w.id, name: w.name, online: w.online && w.enabled, state: !w.enabled ? "잠시 끔" : w.online ? "online" : "꺼짐", capabilities: w.info?.capabilities ?? [], here: false }));
}

/** 그 PC가 이 브라우저 모드를 돌릴 수 없으면 까닭 */
export function pcCannot(pc: MyPc, browser: string): string | null {
  if (browser === "app" && !pc.capabilities.includes("app")) return "앱 안 브라우저 워크플로우는 데스크톱 앱에서만 돕니다";
  if (browser === "wallet" && !pc.capabilities.includes("wallet")) return `«${pc.name}»는 지갑 브라우저를 열 수 없습니다 — 그 PC의 워커 프로그램을 --headed로 켜세요`;
  return null;
}
