/**
 * **데스크톱 앱 다리**(PLAN §44 · apps/desktop/src/preload.cjs) — 편집 화면이 데스크톱 앱 창에서 열렸을 때만 있다.
 * - 앱 안 브라우저로 녹화하면 서버가 뷰 id를 알려 주고(`app-view`), 편집 화면은 라이브 패널 자리를 앱에 알려 뷰를 그 위에 놓는다.
 * - 회사 서버 모드면 이 앱이 그 서버의 **개인 워커**다 — «내 PC에서 실행하기»가 그 워커 id로 보낸다(info · 3초마다 다시 본다).
 */
import { useSyncExternalStore } from "react";

export interface DesktopInfo {
  version: number;
  /** local — 이 PC에서만 · server — 회사 서버에 붙음 */
  mode: "local" | "server" | null;
  server: string | null;
  /** 회사 서버 모드의 이 PC(워커) — state: connecting · online · offline · denied · closed */
  worker: { state: string; id: string | null; name: string | null; message: string | null } | null;
}

export interface DesktopBridge {
  version: number;
  /** rect — 창 안 좌표(CSS px). null이면 숨긴다 */
  placeView(id: string, rect: { x: number; y: number; width: number; height: number } | null): void;
  info?(): Promise<DesktopInfo>;
  /** «연결 바꾸기» — 앱의 처음 화면을 다시 연다 */
  openSetup?(): void;
}

export const desktop = (): DesktopBridge | null => (globalThis as { flowsmithDesktop?: DesktopBridge }).flowsmithDesktop ?? null;

let cached: DesktopInfo | null = null;
const listeners = new Set<() => void>();
const poll = () => {
  void desktop()?.info?.().then((i) => {
    if (JSON.stringify(i) === JSON.stringify(cached)) return;
    cached = i;
    for (const f of listeners) f();
  }, () => undefined);
};
if (desktop()?.info) { poll(); setInterval(poll, 3000); }

/** 지금 아는 것(없으면 null — 앱이 아니거나 아직 못 받음) */
export const desktopNow = (): DesktopInfo | null => cached;

export function useDesktop(): DesktopInfo | null {
  return useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f); }; }, () => cached, () => null);
}

/** 내 PC — 회사 서버 모드에서 이 앱이 붙은 개인 워커(id를 받은 뒤). online이 아니면 지금은 보낼 수 없다 */
export function myPc(i: DesktopInfo | null): { id: string; name: string; online: boolean; state: string } | null {
  if (i?.mode !== "server" || !i.worker?.id) return null;
  return { id: i.worker.id, name: i.worker.name ?? "내 PC", online: i.worker.state === "online", state: i.worker.state };
}
