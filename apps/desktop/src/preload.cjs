// 편집 화면 창의 preload — 데스크톱 앱에서 열렸다는 것 · 녹화하는 앱 안 브라우저 뷰를 라이브 패널 자리에 놓는 길 ·
// 연결 정보(«내 PC에서 실행하기») · 처음 화면의 답(그 화면에서만 받는다 — main.ts)만 내준다.
// ★sandbox 창이라 CommonJS · electron의 contextBridge · ipcRenderer만 쓴다(Node는 없다)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("flowsmithDesktop", {
  version: 1,
  /** rect — 창 안 좌표(CSS px). null이면 숨긴다 */
  placeView: (id, rect) => ipcRenderer.send("fs:place-view", String(id), rect ? { x: +rect.x, y: +rect.y, width: +rect.width, height: +rect.height } : null),
  /** 어떻게 켜졌나 — { mode: "local" | "server", server, worker: { state, id, name, message } | null } */
  info: () => ipcRenderer.invoke("fs:desktop"),
  /** 처음 화면의 답 — { mode, server, token } → { ok } | { ok: false, error } */
  setup: (choice) => ipcRenderer.invoke("fs:setup", { mode: String(choice?.mode ?? ""), server: String(choice?.server ?? ""), token: String(choice?.token ?? "") }),
  /** «연결 바꾸기» — 처음 화면을 다시 연다 */
  openSetup: () => ipcRenderer.send("fs:open-setup"),
});
