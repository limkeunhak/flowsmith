/**
 * 워커(젠킨스의 노드) — 실행을 받아 가는 PC들 (run/worker-hub.ts · PLAN §26)
 *
 *   GET    /api/workers                 서버 줄 + 워커들(지금 연결 · 도는 실행 · 줄) + 쓰인 라벨. 관리자가 아니면 내 팀이 쓸 수 있는 것만
 *   POST   /api/workers                 (관리자) { name, labels?, slots?, team?, kind?, owner? } → 201 { worker, token } — ★토큰은 이때 한 번만
 *                                       kind: shared(공용 — 기본) · personal(개인 — owner의 «내 PC에서» 실행만)
 *   PUT    /api/workers/:id             (관리자) { name?, labels?, slots?, enabled? }
 *   POST   /api/workers/:id/token       (관리자) 새 토큰 — 옛 토큰으로 붙어 있던 연결은 끊긴다
 *   DELETE /api/workers/:id             (관리자) 이 워커에서 돌게 정해 둔 플로우가 있으면 409
 *   PUT    /api/flows/:id/run-on        (편집자) { on: null | "worker:<id>" | "label:<라벨>" } 어디서 돌리나
 *
 * 워커 프로그램은 WebSocket /api/workers/connect로 붙는다(워커 토큰 — 로그인과 따로).
 */
import type { WorkerRow } from "../../storage/store.ts";
import { userOf } from "../../auth/auth.ts";
import { route, type Route } from "../router.ts";
import type { ApiDeps } from "../api.ts";
import { visibleTo } from "../../rules/teams.ts";

export function workerRoutes({ store, runs, auth, workers }: ApiDeps): Route[] {
  const view = (w: WorkerRow, now = workers.live()) => {
    const live = now.get(w.id);
    return { ...w, info: workers.info(w.id) ?? w.info, online: live?.online ?? false, connectedAt: live?.connectedAt ?? null, running: live?.running ?? [], queued: live?.queued ?? 0, recording: live?.recording ?? 0 };
  };
  return [
    route("GET", "/api/workers", (req) => {
      const me = userOf(req);
      const mine = auth.teamsFor(me);
      // 개인 워커는 관리자와 그 주인만 본다(로그인을 끈 서버면 모두)
      const own = (w: WorkerRow) => w.kind === "shared" || !me || me.role === "admin" || w.owner?.toLowerCase() === me.email.toLowerCase();
      const list = store.listWorkers().filter((w) => own(w) && visibleTo(mine, w.team?.id ?? null));
      return {
        server: runs.localLoad(),
        workers: (() => { const now = workers.live(); return list.map((w) => view(w, now)); })(),
        labels: [...new Set(list.flatMap((w) => w.labels))].sort(),
      };
    }),
    route("POST", "/api/workers", async (_q, res, _p, body) => {
      const b = await body();
      const team = typeof b["team"] === "string" && b["team"] ? b["team"] : null;
      const { worker, token } = store.createWorker({ name: String(b["name"] ?? ""), labels: b["labels"] ?? [], slots: b["slots"] ?? 1, team, kind: b["kind"], owner: b["owner"] });
      res.statusCode = 201;
      return { worker: view(worker), token };
    }),
    route("PUT", "/api/workers/:id", async (_q, _r, p, body) => {
      const b = await body();
      const w = store.updateWorker(p["id"]!, { name: b["name"], labels: b["labels"], slots: b["slots"], enabled: b["enabled"] });
      workers.refresh();
      return view(w);
    }),
    route("POST", "/api/workers/:id/token", (_q, _r, p) => {
      const token = store.renewWorkerToken(p["id"]!);
      workers.disconnect(p["id"]!, "토큰이 바뀌었습니다 — 새 토큰으로 다시 켜세요");
      return { token };
    }),
    route("DELETE", "/api/workers/:id", (_q, res, p) => {
      store.deleteWorker(p["id"]!);
      workers.disconnect(p["id"]!, "이 워커가 지워졌습니다");
      res.statusCode = 204;
      return null;
    }),
    route("PUT", "/api/flows/:id/run-on", async (_q, _r, p, body) => {
      const on = store.setFlowRunOn(p["id"]!, (await body())["on"]);
      return { runOn: on };
    }),
  ];
}
