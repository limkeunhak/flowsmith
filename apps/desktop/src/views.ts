/**
 * **앱 안 브라우저 뷰**(3단계 · DESKTOP.md §4) — 서버 안 워커가 부탁하면 WebContentsView를 연다. 워커는 CDP로 그 뷰를 Page로 받는다.
 *
 *   실행(run)    따로 창 하나에 뷰 하나 — 앞으로 가져오지 않고 띄운다 · 사람 기다리기가 시작되면 앞으로(view:focus). 실행이 끝나면 닫힌다
 *   녹화(record) 편집 화면 창 위 — 편집 화면이 라이브 패널 자리를 알려 주면(preload의 placeView) 그 자리에 놓는다. 알려 주지 않으면 숨긴다
 *
 * ★뷰마다 따로 세션(메모리 — 끄면 사라진다) — 실행 사이에 쿠키가 새지 않는다(지금 실행마다 새 컨텍스트를 쓰는 것과 같은 결).
 * 파일 받기는 묻지 않고 그 뷰의 임시 폴더에 받는다(뷰를 닫으면 지운다 — 띄우는 브라우저와 같다).
 * ★뷰는 처음에 표시 주소를 연다 — 워커는 그 주소로 자기 뷰만 고른다(packages/worker app-views.ts의 viewMarkUrl과 같게).
 */
import { BaseWindow, ipcMain, WebContentsView, type BrowserWindow, type UtilityProcess } from "electron";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

type ViewRequest = { t: "view:open"; id: string; purpose: "run" | "record"; title: string } | { t: "view:close"; id: string } | { t: "view:focus"; id: string };
interface Rect { x: number; y: number; width: number; height: number }

const viewMarkUrl = (id: string): string => `data:text/html;charset=utf-8,%3Ctitle%3EFlowsmith%3C%2Ftitle%3E#fs-view=${id}`;
/** 이보다 좁으면 사이트가 모바일 배치가 된다 — 뷰를 줄여 보인다(녹화기의 MIN_WIDTH와 같은 값) */
const MIN_WIDTH = 1024;
const ID_RE = /^[0-9a-f-]{36}$/;

interface Entry {
  view: WebContentsView;
  purpose: "run" | "record";
  /** 실행 창(run) */
  host: BaseWindow | null;
  zoom: number;
}

export class Views {
  readonly #views = new Map<string, Entry>();
  readonly #editor: () => BrowserWindow | null;
  readonly #log: (text: string) => void;
  #server: UtilityProcess | null = null;

  constructor(editor: () => BrowserWindow | null, log: (text: string) => void) {
    this.#editor = editor;
    this.#log = log;
    // 편집 화면이 라이브 패널 자리를 알린다 — 편집 화면 창이 보낸 것만 · 녹화 뷰만
    ipcMain.on("fs:place-view", (e, id: unknown, rect: unknown) => {
      if (e.sender !== this.#editor()?.webContents || typeof id !== "string") return;
      const v = this.#views.get(id);
      if (v?.purpose === "record") this.#place(v, isRect(rect) ? rect : null);
    });
  }

  /** 서버(utilityProcess)의 메시지 — 뷰를 열고 닫는다 */
  serve(server: UtilityProcess): void {
    this.#server = server;
    server.on("message", (m: Partial<ViewRequest> | null) => {
      if (!m || typeof m.id !== "string" || !ID_RE.test(m.id)) return;
      if (m.t === "view:open") void this.#open(m.id, m.purpose === "record" ? "record" : "run", String(m.title ?? "").slice(0, 120));
      else if (m.t === "view:close") this.#close(m.id);
      // 사람을 기다리기 시작했다 — 실행 창을 앞으로(사람이 그 창에서 한다)
      else if (m.t === "view:focus") { const h = this.#views.get(m.id)?.host; if (h && !h.isDestroyed()) { if (h.isMinimized()) h.restore(); h.show(); h.focus(); this.#log("사람을 기다립니다 — 실행 창을 앞으로"); } }
    });
  }

  #reply(m: { t: "view:opened"; id: string } | { t: "view:failed"; id: string; message: string }): void {
    try { this.#server?.postMessage(m); } catch { /* 서버가 꺼졌다 */ }
  }

  async #open(id: string, purpose: "run" | "record", title: string): Promise<void> {
    if (this.#views.has(id)) return;
    try {
      const view = new WebContentsView({ webPreferences: { partition: `fs-view-${id}`, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
      const entry: Entry = { view, purpose, host: null, zoom: 1 };
      this.#views.set(id, entry);
      // 줄여 보이는 비율은 주소가 바뀌면(다른 사이트) 처음으로 돌아간다 — 다시 맞춘다
      view.webContents.on("did-navigate", () => { if (entry.zoom !== 1) view.webContents.setZoomFactor(entry.zoom); });
      // 파일 받기 — Electron은 «다른 이름으로 저장» 창을 띄운다(실행이 그 창 앞에서 멈춘 채 사람을 기다린다).
      //  띄우는 브라우저처럼 묻지 않고 받는다 — 이 뷰의 임시 폴더에(뷰를 닫으면 지운다)
      view.webContents.session.on("will-download", (_e, item) => {
        const dir = join(tmpdir(), "flowsmith-downloads", id);
        mkdirSync(dir, { recursive: true });
        item.setSavePath(join(dir, basename(item.getFilename()) || "download"));
        this.#log(`파일 받기(${purpose === "run" ? "실행" : "녹화"}): ${item.getFilename()}`);
      });
      if (purpose === "run") {
        const host = new BaseWindow({ width: 1280, height: 860, title: `Flowsmith 실행 — ${title || "앱 안 브라우저"}`, show: false, backgroundColor: "#ffffff" });
        entry.host = host;
        host.contentView.addChildView(view);
        const fit = () => { const b = host.getContentBounds(); view.setBounds({ x: 0, y: 0, width: b.width, height: b.height }); };
        fit();
        host.on("resize", fit);
        // 사람이 창을 닫으면 뷰도 끝 — 그 실행은 페이지가 닫혀 멈춘다
        host.on("closed", () => { if (this.#views.get(id) === entry) { this.#views.delete(id); if (!view.webContents.isDestroyed()) view.webContents.close(); } });
        host.showInactive();
      } else {
        const editor = this.#editor();
        if (!editor) throw new Error("편집 화면 창이 없습니다");
        view.setVisible(false);
        editor.contentView.addChildView(view);
      }
      await view.webContents.loadURL(viewMarkUrl(id));
      this.#log(`앱 안 브라우저 열기(${purpose === "run" ? "실행" : "녹화"}): ${title}`);
      this.#reply({ t: "view:opened", id });
    } catch (e) {
      this.#close(id);
      this.#reply({ t: "view:failed", id, message: (e as Error).message });
    }
  }

  #place(v: Entry, rect: Rect | null): void {
    if (!rect || rect.width < 50 || rect.height < 50) { v.view.setVisible(false); return; }
    const r = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    v.view.setBounds(r);
    const zoom = Math.min(1, r.width / MIN_WIDTH);
    if (Math.abs(zoom - v.zoom) > 0.01) { v.zoom = zoom; v.view.webContents.setZoomFactor(zoom); }
    v.view.setVisible(true);
  }

  #close(id: string): void {
    const v = this.#views.get(id);
    if (!v) return;
    this.#views.delete(id);
    if (v.purpose === "record") this.#editor()?.contentView.removeChildView(v.view);
    if (!v.view.webContents.isDestroyed()) v.view.webContents.close();
    if (v.host && !v.host.isDestroyed()) v.host.destroy();
    rmSync(join(tmpdir(), "flowsmith-downloads", id), { recursive: true, force: true });
  }
}

function isRect(r: unknown): r is Rect {
  const o = r as Partial<Rect> | null;
  return !!o && [o.x, o.y, o.width, o.height].every((n) => typeof n === "number" && Number.isFinite(n));
}
