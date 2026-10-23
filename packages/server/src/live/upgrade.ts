/**
 * **WebSocket 길 모음** — 서버의 upgrade를 한 곳에서 받아 길마다 나눈다.
 *
 *   /api/live                 녹화(live/recorder-hub.ts)
 *   /api/runs/:id/screen      실행 화면(live/run-screens.ts)
 *   /api/workers/connect      워커 프로그램(run/worker-hub.ts)
 *
 * ★맞는 길이 없으면 404로 끊는다 — 받는 쪽이 서로의 길을 알 필요가 없다(새 길은 add 한 줄).
 * ★거절은 reject로 — 상태 코드가 곳마다 다르지 않게.
 */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

export type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer, match: RegExpExecArray) => void;

const STATUS: Record<number, string> = { 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found" };

/** 연결을 받지 않는다 — HTTP 상태를 쓰고 끊는다 */
export function reject(socket: Duplex, status: 400 | 401 | 403 | 404): void {
  socket.write(`HTTP/1.1 ${status} ${STATUS[status]}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export class Upgrades {
  readonly #routes: { path: RegExp; handle: UpgradeHandler }[] = [];

  constructor(server: Server) {
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      for (const r of this.#routes) {
        const m = r.path.exec(path);
        if (m) { r.handle(req, socket, head, m); return; }
      }
      reject(socket, 404);
    });
  }

  /** 길 하나 — path는 주소 전체에 맞는 정규식(^…$) */
  add(path: RegExp, handle: UpgradeHandler): void {
    this.#routes.push({ path, handle });
  }
}
