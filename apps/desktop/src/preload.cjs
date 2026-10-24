// 편집 화면 창의 preload — 데스크톱 앱에서 열렸다는 것과, 녹화하는 앱 안 브라우저 뷰를 라이브 패널 자리에 놓는 길 하나만 내준다.
// ★sandbox 창이라 CommonJS · electron의 contextBridge · ipcRenderer만 쓴다(Node는 없다)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("flowsmithDesktop", {
  version: 1,
  /** rect — 창 안 좌표(CSS px). null이면 숨긴다 */
  placeView: (id, rect) => ipcRenderer.send("fs:place-view", String(id), rect ? { x: +rect.x, y: +rect.y, width: +rect.width, height: +rect.height } : null),
});
