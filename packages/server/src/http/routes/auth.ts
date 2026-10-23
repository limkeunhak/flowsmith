/**
 * 로그인 · 사람 (auth/auth.ts)
 *
 *   GET    /api/auth/me                 { auth: "off" } · { auth: "on", user, setup } — 로그인 안 했으면 user: null
 *   POST   /api/auth/setup              { token, email, name, password } 첫 관리자 — 사람이 하나도 없을 때만 · 설정 토큰(콘솔)
 *   POST   /api/auth/login              { email, password } (임시 — 로그인 서버를 잇기 전까지)
 *   POST   /api/auth/logout
 *   POST   /api/auth/password           { current, next } 내 비밀번호 바꾸기 — 다른 로그인은 끊는다
 *
 *   GET    /api/users                   (관리자) 사람들
 *   POST   /api/users                   (관리자) { email, name, role } → { user, tempPassword } ★임시 비밀번호는 이때만 보인다
 *   PUT    /api/users/:id               (관리자) { name?, role?, disabled? } — 마지막 관리자는 내리거나 끌 수 없다
 *   POST   /api/users/:id/reset         (관리자) 임시 비밀번호 새로 → { tempPassword } · 그 사람의 로그인을 끊는다
 *
 *   GET    /api/teams                   (관리자) 팀 · 사람 · 플로우 수
 *   POST   /api/teams                   (관리자) { name }
 *   PUT    /api/teams/:id               (관리자) { name }
 *   DELETE /api/teams/:id               (관리자) 플로우가 남아 있으면 409
 *   PUT    /api/teams/:id/members/:uid  (관리자) 팀에 넣기 · DELETE 빼기
 */
import { USER_ROLES, type UserRole } from "../../storage/store.ts";
import { hashPassword, tempPassword, verifyPassword, weakPassword } from "../../auth/passwords.ts";
import { userOf } from "../../auth/auth.ts";
import { HttpError, route, type Route } from "../router.ts";
import type { ApiDeps } from "../api.ts";
import { sameSecret } from "../../auth/tokens.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (b: Record<string, unknown>, k: string): string => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
const roleOf = (v: unknown): UserRole => {
  if (!(USER_ROLES as readonly string[]).includes(String(v))) throw new HttpError(400, `역할은 ${USER_ROLES.join(" · ")} 중 하나입니다`);
  return v as UserRole;
};

export function authRoutes({ store, auth }: ApiDeps): Route[] {
  const admins = () => store.listUsers().filter((u) => u.role === "admin" && !u.disabled);
  return [
    route("GET", "/api/auth/me", (req) => {
      if (!auth.enabled) return { auth: "off" };
      const u = userOf(req);
      // 내 팀 — 플로우를 만들 때 고른다(관리자는 모든 팀)
      const teams = !u ? [] : u.role === "admin" ? store.listTeams().map((t) => ({ id: t.id, name: t.name })) : store.teamsOf(u.id);
      return { auth: "on", user: u, setup: auth.needsSetup, teams };
    }),
    route("POST", "/api/auth/setup", async (req, res, _p, body) => {
      if (!auth.needsSetup || !auth.setupToken) throw new HttpError(409, "이미 관리자가 있습니다 — 로그인하세요");
      const b = await body();
      if (!sameSecret(str(b, "token"), auth.setupToken)) throw new HttpError(403, "설정 토큰이 맞지 않습니다 — 서버를 띄울 때 콘솔에 찍힌 토큰을 넣으세요");
      const email = str(b, "email"), name = str(b, "name"), password = typeof b["password"] === "string" ? b["password"] : "";
      if (!EMAIL.test(email)) throw new HttpError(400, "메일 주소를 확인하세요");
      const weak = weakPassword(password);
      if (weak) throw new HttpError(400, weak);
      const user = store.insertUser({ email, name: name || email, role: "admin", pwHash: await hashPassword(password), mustChange: false });
      auth.setupToken = null;
      auth.open(req, res, user);
      return { user };
    }),
    route("POST", "/api/auth/login", async (req, res, _p, body) => {
      if (!auth.enabled) throw new HttpError(409, "이 서버는 로그인을 쓰지 않습니다");
      const b = await body();
      const user = await auth.login(str(b, "email"), typeof b["password"] === "string" ? b["password"] : "", req.socket.remoteAddress ?? "");
      auth.open(req, res, user);
      return { user };
    }),
    route("POST", "/api/auth/logout", (req, res) => { auth.close(req, res); res.statusCode = 204; return null; }),
    route("POST", "/api/auth/password", async (req, _r, _p, body) => {
      const me = userOf(req);
      if (!me) throw new HttpError(401, "로그인이 필요합니다");
      const b = await body();
      const full = store.userByEmail(me.email)!;
      if (full.pwHash === "external") throw new HttpError(409, "로그인 서버로 들어온 사람은 여기서 비밀번호를 바꾸지 않습니다");
      if (!(await verifyPassword(typeof b["current"] === "string" ? b["current"] : "", full.pwHash))) throw new HttpError(403, "지금 비밀번호가 맞지 않습니다");
      const next = typeof b["next"] === "string" ? b["next"] : "";
      const weak = weakPassword(next);
      if (weak) throw new HttpError(400, weak);
      store.updateUser(me.id, { pwHash: await hashPassword(next), mustChange: false });
      store.deleteSessionsOf(me.id, auth.sessionHash(req));
      return { ok: true };
    }),

    route("GET", "/api/users", () => store.listUsers()),
    route("POST", "/api/users", async (_q, res, _p, body) => {
      const b = await body();
      const email = str(b, "email");
      if (!EMAIL.test(email)) throw new HttpError(400, "메일 주소를 확인하세요");
      const pw = tempPassword();
      const user = store.insertUser({ email, name: str(b, "name") || email, role: roleOf(b["role"] ?? "viewer"), pwHash: await hashPassword(pw), mustChange: true });
      res.statusCode = 201;
      return { user, tempPassword: pw };
    }),
    route("PUT", "/api/users/:id", async (_q, _r, p, body) => {
      const b = await body();
      const target = store.getUser(p["id"]!);
      const role = b["role"] === undefined ? undefined : roleOf(b["role"]);
      const disabled = typeof b["disabled"] === "boolean" ? b["disabled"] : undefined;
      // ★마지막 관리자를 잃지 않게
      const losesAdmin = target.role === "admin" && !target.disabled && ((role !== undefined && role !== "admin") || disabled === true);
      if (losesAdmin && admins().length <= 1) throw new HttpError(409, "마지막 관리자는 내리거나 끌 수 없습니다 — 다른 관리자를 먼저 두세요");
      const u = store.updateUser(target.id, { ...(typeof b["name"] === "string" && b["name"].trim() ? { name: b["name"].trim() } : {}), ...(role ? { role } : {}), ...(disabled !== undefined ? { disabled } : {}) });
      if (disabled) store.deleteSessionsOf(target.id);
      return u;
    }),
    route("POST", "/api/users/:id/reset", async (_q, _r, p) => {
      const target = store.getUser(p["id"]!);
      const pw = tempPassword();
      store.updateUser(target.id, { pwHash: await hashPassword(pw), mustChange: true });
      store.deleteSessionsOf(target.id);
      return { tempPassword: pw };
    }),

    route("GET", "/api/teams", () => store.listTeams()),
    route("POST", "/api/teams", async (_q, res, _p, body) => { const t = store.createTeam(str(await body(), "name")); res.statusCode = 201; return t; }),
    route("PUT", "/api/teams/:id", async (_q, _r, p, body) => store.renameTeam(p["id"]!, str(await body(), "name"))),
    route("DELETE", "/api/teams/:id", (_q, res, p) => { store.deleteTeam(p["id"]!); res.statusCode = 204; return null; }),
    route("PUT", "/api/teams/:id/members/:uid", (_q, _r, p) => { store.addMember(p["id"]!, p["uid"]!); return store.getTeam(p["id"]!); }),
    route("DELETE", "/api/teams/:id/members/:uid", (_q, _r, p) => { store.removeMember(p["id"]!, p["uid"]!); return store.getTeam(p["id"]!); }),
  ];
}
