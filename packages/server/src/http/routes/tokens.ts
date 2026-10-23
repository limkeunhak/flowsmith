/**
 * API 토큰 — 밖(스크립트 · 다른 시스템)에서 API를 부를 때. `Authorization: Bearer fsa_…`
 *
 *   GET    /api/tokens        내 토큰들(값은 없다)
 *   POST   /api/tokens        { name, role?, days? } → 201 { token, row } — ★토큰은 이때 한 번만
 *   DELETE /api/tokens/:id    지우기(관리자는 누구의 것이든)
 *
 * ★역할은 내 역할 이하 — 토큰을 쓸 때마다 그 사람의 지금 역할과 견주어 낮은 쪽으로 · 사람을 끄면 그 토큰도 막힌다.
 * ★API 토큰으로는 토큰을 만들 수 없다 — 새는 토큰이 스스로 늘지 않게(화면에서 로그인해 만든다).
 */
import { USER_ROLES, type UserRole } from "../../storage/store.ts";
import { byToken, userOf } from "../../auth/auth.ts";
import { HttpError, route, type Route } from "../router.ts";
import type { ApiDeps } from "../api.ts";

const RANK: Record<UserRole, number> = { viewer: 0, runner: 1, editor: 2, admin: 3 };

export function tokenRoutes({ store, auth }: ApiDeps): Route[] {
  const me = (req: Parameters<typeof userOf>[0]) => {
    if (!auth.enabled) throw new HttpError(400, "로그인을 끈 서버입니다 — API 토큰 없이 그냥 부르면 됩니다");
    const u = userOf(req);
    if (!u) throw new HttpError(401, "로그인이 필요합니다");
    return u;
  };
  return [
    route("GET", "/api/tokens", (req) => store.listApiTokens(me(req).id)),
    route("POST", "/api/tokens", async (req, res, _p, body) => {
      const u = me(req);
      if (byToken(req)) throw new HttpError(403, "API 토큰으로는 토큰을 만들 수 없습니다 — 화면에서 로그인해 만드세요");
      const b = await body();
      const name = typeof b["name"] === "string" ? b["name"].trim() : "";
      if (!name) throw new HttpError(400, "어디에 쓰는 토큰인지 이름을 주세요");
      const role = (b["role"] ?? u.role) as UserRole;
      if (!USER_ROLES.includes(role)) throw new HttpError(400, `역할은 ${USER_ROLES.join(" · ")} 중 하나입니다`);
      if (RANK[role] > RANK[u.role]) throw new HttpError(403, "내 역할보다 높은 토큰은 만들 수 없습니다");
      const days = b["days"] === undefined || b["days"] === null ? null : Number(b["days"]);
      if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) throw new HttpError(400, "days는 1~365입니다(없으면 끝나지 않음)");
      const expiresAt = days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString();
      const made = store.createApiToken({ userId: u.id, name, role, expiresAt });
      res.statusCode = 201;
      return made;
    }),
    route("DELETE", "/api/tokens/:id", (req, res, p) => {
      const u = me(req);
      if (!store.deleteApiToken(p["id"]!, u.role === "admin" ? null : u.id)) throw new HttpError(404, "없는 토큰입니다");
      res.statusCode = 204;
      return null;
    }),
  ];
}
