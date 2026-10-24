/**
 * **데스크톱 앱 다리**(PLAN §44 · apps/desktop/src/preload.cjs) — 편집 화면이 데스크톱 앱 창에서 열렸을 때만 있다.
 * 앱 안 브라우저로 녹화하면 서버가 뷰 id를 알려 주고(`app-view`), 편집 화면은 라이브 패널 자리를 앱에 알려 뷰를 그 위에 놓는다.
 */
export interface DesktopBridge {
  version: number;
  /** rect — 창 안 좌표(CSS px). null이면 숨긴다 */
  placeView(id: string, rect: { x: number; y: number; width: number; height: number } | null): void;
}

export const desktop = (): DesktopBridge | null => (globalThis as { flowsmithDesktop?: DesktopBridge }).flowsmithDesktop ?? null;
