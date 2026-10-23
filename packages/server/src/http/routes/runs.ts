/**
 * 실행 · 변경 감시(점검)
 *
 *   POST   /api/flows/:id/runs                     { version?: n | "draft", params?, stopBefore?, stopAfter?, on? } → 202 { runId }
 *                                                  on — 이번만 어디서(「server」 · 「worker:<id>」 · 「label:<라벨>」). 없으면 플로우 설정대로
 *                                                  stopBefore · stopAfter — 초안을 그 노드 앞까지 · 그 노드까지만(편집 화면의 «단계 실행»)
 *   GET    /api/flows/:id/runs                     최근 실행들(결과 본문 없이)
 *   GET    /api/runs/:runId                        실행 기록 (결과 포함)
 *   GET    /api/runs/:runId/events                 SSE — 진행을 흘려 준다
 *   POST   /api/runs/:runId/cancel                 멈추기 — 그 실행이 부른 실행도 함께. 돌고 있지 않으면 409
 *   POST   /api/runs/:runId/rerun                  같은 입력 · 같은 버전으로 다시(초안 실행이면 지금 초안) → 202 { runId }
 *   GET    /api/runs/:runId/shot                   검사가 불통과였을 때의 페이지(JPEG) — 없으면 404
 *   GET    /api/runs/:runId/approval               기다리는 승인(없으면 null)
 *   POST   /api/runs/:runId/approval               { approved, comment? } 승인 · 거절 — 노드가 정한 역할 이상
 *   GET    /api/approvals                          승인을 기다리는 실행들(내가 볼 수 있는 플로우만)
 *   GET    /api/flows/:id/probes                   변경 감시 기록(점검 실행 · 실행 중 발견)
 *   POST   /api/flows/:id/probes                   { version?: n | "draft" } 지금 점검 → 202 { probeId }
 *   GET    /api/probes/:id                         점검 하나(보고서 포함)
 *
 * ☆실행 화면 보기(WebSocket /api/runs/:id/screen)는 live/run-screens.ts가 받는다.
 */
import type { ServerResponse } from "node:http";
import type { Watch } from "../../run/runs.ts";
import { HttpError, positiveInt, query, route, type Route } from "../router.ts";
import type { ApiDeps } from "../api.ts";
import { byOf, userOf } from "../../auth/auth.ts";

function sse(res: ServerResponse, e: Watch): void {
  res.write(`event: ${e.kind}\ndata: ${JSON.stringify(e)}\n\n`);
}

export function runRoutes({ store, runs, monitor, auth }: ApiDeps): Route[] {
  return [
    route("POST", "/api/flows/:id/runs", async (req, res, p, body) => {
      const b = await body();
      const v = b["version"];
      // 실행자는 게시된 버전만 — 초안을 돌리는 것(시험 · 단계 실행)은 편집자의 일이다
      if (v === "draft" && userOf(req)?.role === "runner") throw new HttpError(403, "실행자는 게시된 버전만 돌립니다 — 초안 시험은 편집자 이상");
      if (v !== undefined && v !== "draft" && (typeof v !== "number" || !Number.isInteger(v))) throw new HttpError(400, 'version은 정수 또는 "draft"여야 합니다');
      const params = b["params"];
      if (params !== undefined && (params === null || typeof params !== "object" || Array.isArray(params))) throw new HttpError(400, "params는 객체여야 합니다");
      const runId = runs.start(p["id"]!, {
        ...(v === undefined ? {} : { version: v as number | "draft" }),
        params: (params ?? {}) as Record<string, string>,
        trigger: b["trigger"] === "api" ? "api" : "manual",
        startedBy: byOf(req),
        ...(typeof b["stopBefore"] === "string" ? { stopBefore: b["stopBefore"] } : {}),
        ...(typeof b["stopAfter"] === "string" ? { stopAfter: b["stopAfter"] } : {}),
        ...(b["on"] !== undefined ? { on: b["on"] as string | null } : {}),
      });
      res.statusCode = 202;
      return { runId };
    }),
    route("GET", "/api/flows/:id/runs", (req, _r, p) => {
      const limit = query(req).get("limit");
      // 목록에는 결과 본문을 싣지 않는다 — 무겁다
      return store.listRuns(p["id"]!, limit ? positiveInt(limit, "limit") : 50).map(({ result: _, ...r }) => r);
    }),
    route("GET", "/api/runs/:runId", (_q, _r, p) => store.getRun(p["runId"]!)),
    route("POST", "/api/runs/:runId/rerun", (req, res, p) => {
      const row = store.getRun(p["runId"]!);
      // 초안 실행을 다시 — 초안은 편집자의 일(실행자는 게시된 버전만)
      if (row.version === null && userOf(req)?.role === "runner") throw new HttpError(403, "실행자는 게시된 버전만 돌립니다 — 초안으로 돈 실행은 편집자 이상이 다시 돌립니다");
      const runId = runs.start(row.flowId, { version: row.version ?? "draft", params: row.params, trigger: "manual", startedBy: byOf(req) });
      res.statusCode = 202;
      return { runId, version: row.version };
    }),
    route("GET", "/api/runs/:runId/shot", (_q, res, p) => {
      store.getRun(p["runId"]!);
      const s = store.runShot(p["runId"]!);
      if (!s) throw new HttpError(404, "이 실행에는 스크린샷이 없습니다(검사가 불통과였을 때만 찍습니다)");
      res.writeHead(200, { "content-type": s.mime, "content-length": s.data.byteLength, "cache-control": "private, max-age=3600" });
      res.end(Buffer.from(s.data));
      return undefined;
    }),
    route("GET", "/api/runs/:runId/approval", (_q, _r, p) => { store.getRun(p["runId"]!); return runs.approvalOf(p["runId"]!); }),
    route("POST", "/api/runs/:runId/approval", async (req, _r, p, body) => {
      store.getRun(p["runId"]!);
      const b = await body();
      if (typeof b["approved"] !== "boolean") throw new HttpError(400, "approved(true · false)를 주세요");
      const comment = typeof b["comment"] === "string" ? b["comment"] : "";
      const u = userOf(req);
      runs.answerApproval(p["runId"]!, { approved: b["approved"], comment, by: byOf(req), role: auth.enabled ? (u?.role ?? "viewer") : null });
      return { ok: true };
    }),
    route("GET", "/api/approvals", (req) => runs.pendingApprovals().filter((a) => auth.canSeeFlow(userOf(req), a.flowId))),
    route("POST", "/api/runs/:runId/cancel", (_q, res, p) => {
      store.getRun(p["runId"]!);
      if (!runs.cancel(p["runId"]!)) throw new HttpError(409, "돌고 있는 실행이 아닙니다 — 이미 끝났습니다");
      res.statusCode = 202;
      return { cancelling: true };
    }),
    route("GET", "/api/runs/:runId/events", (req, res, p) => {
      const run = store.getRun(p["runId"]!);
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
      const end = () => { unsubscribe?.(); res.end(); };
      let unsubscribe: (() => void) | null = null;
      unsubscribe = runs.subscribe(run.id, (e) => { sse(res, e); if (e.kind === "run:end") setImmediate(end); });
      if (unsubscribe === null) {
        // 이미 끝났고 기억에서도 지워졌다 — 끝만 알린다
        sse(res, { kind: "run:end", status: run.status === "running" ? "failure" : run.status, message: run.message });
        res.end();
      }
      req.on("close", () => unsubscribe?.());
      return undefined; // 응답은 여기서 직접 다룬다
    }),

    route("GET", "/api/flows/:id/probes", (_q, _r, p) => store.listProbes(p["id"]!)),
    route("POST", "/api/flows/:id/probes", async (_q, res, p, body) => {
      const v = (await body())["version"];
      if (v !== undefined && v !== "draft" && (typeof v !== "number" || !Number.isInteger(v))) throw new HttpError(400, 'version은 정수 또는 "draft"여야 합니다');
      const version = (v as number | "draft" | undefined) ?? store.activeVersion(p["id"]!) ?? "draft";
      res.statusCode = 202;
      return { probeId: monitor.probe(p["id"]!, version) };
    }),
    route("GET", "/api/probes/:id", (_q, _r, p) => store.getProbe(p["id"]!)),
  ];
}
