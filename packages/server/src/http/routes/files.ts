/**
 * 파일 쓰기 노드가 쓴 파일들 — 보기 · 받기 · 지우기 (storage/files.ts)
 *
 *   GET    /api/files?dir=                         파일 뿌리 아래 한 겹
 *          /api/files?flow=:id&scope=flow|shared&dir=   그 플로우의 폴더(files/<uid>/dir) · 공유 폴더(files/shared/dir) 아래
 *   GET    /api/files/preview?path=                파일 앞부분(64KB)
 *   GET    /api/files/download?path=[&as=xlsx]     내려받기 · as=xlsx면 CSV · JSON Lines · JSON을 엑셀로 바꿔서
 *   DELETE /api/files?path=                        지우기
 */
import { SHARED_DIR } from "@flowsmith/core";
import type { Files } from "../../storage/files.ts";
import { HttpError, query, route, type Route } from "../router.ts";
import type { ApiDeps } from "../api.ts";
import { userOf } from "../../auth/auth.ts";
import type { IncomingMessage } from "node:http";

export function fileRoutes({ store, files = null, auth }: ApiDeps): Route[] {
  const root = (): Files => { if (!files) throw new HttpError(404, "이 서버는 파일 저장을 쓰지 않습니다"); return files; };
  /**
   * ★팀 — 파일 뿌리 아래 첫 폴더가 누구의 것인가: shared(공유)는 모두 · 플로우 uid면 그 플로우를 볼 수 있어야 ·
   *  그 밖(뿌리 전체)은 관리자만(로그인을 켰을 때)
   */
  const mayTouch = (req: IncomingMessage, rel: string) => {
    if (!auth.enabled) return;
    const u = userOf(req);
    const first = rel.replace(/^\/+/, "").split("/")[0] ?? "";
    if (first === SHARED_DIR) return;
    const flowId = first ? store.flowIdByUid(first) : null;
    if (flowId !== null && auth.canSeeFlow(u, flowId)) return;
    if (u?.role === "admin") return;
    throw new HttpError(404, "없는 파일입니다");
  };
  return [
    route("GET", "/api/files", (req) => {
      const q = query(req);
      const dir = q.get("dir") ?? "";
      const flow = q.get("flow");
      if (flow === null) { mayTouch(req, dir); return root().list(dir); }
      if (auth.enabled && !auth.canSeeFlow(userOf(req), flow)) throw new HttpError(404, "없는 워크플로우입니다");
      // 파일 쓰기 노드의 폴더 — 이 플로우 폴더는 서버만 아는 uid로
      const base = q.get("scope") === "shared" ? SHARED_DIR : store.flowUid(flow);
      return root().list(dir ? `${base}/${dir}` : base);
    }),
    route("DELETE", "/api/files", async (req, res) => { const p = query(req).get("path") ?? ""; mayTouch(req, p); await root().remove(p); res.statusCode = 204; return null; }),
    route("GET", "/api/files/preview", (req) => { const p = query(req).get("path") ?? ""; mayTouch(req, p); return root().preview(p); }),
    route("GET", "/api/files/download", async (req, res) => {
      const q = query(req);
      mayTouch(req, q.get("path") ?? "");
      if (q.get("as") === "xlsx") await root().downloadXlsx(q.get("path") ?? "", res);
      else await root().download(q.get("path") ?? "", res);
      return undefined;
    }),
  ];
}
