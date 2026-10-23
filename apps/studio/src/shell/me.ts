/**
 * 지금 누가 — 로그인한 사람 · 역할. 로그인을 끈 서버(혼자 쓰기)면 user는 null이고 무엇이든 할 수 있다.
 * ★화면은 «보이기만» 바꾼다 — 막는 것은 서버다(auth/auth.ts의 needOf).
 */
import { createContext, useContext } from "react";
import { ROLE_LABEL } from "@flowsmith/core";

export type Role = "admin" | "editor" | "runner" | "viewer";
export { ROLE_LABEL };
const RANK: Record<Role, number> = { viewer: 0, runner: 1, editor: 2, admin: 3 };

export interface User { id: string; email: string; name: string; role: Role; disabled: boolean; mustChange: boolean; createdAt: string; lastLoginAt: string | null }

export interface Team { id: string; name: string }

export interface Me {
  /** 로그인을 쓰나 */
  auth: boolean;
  user: User | null;
  /** 플로우를 둘 수 있는 팀(관리자는 모든 팀) — 비면 공용만 */
  teams: Team[];
  can: (need: Role) => boolean;
}

export const meOf = (auth: boolean, user: User | null, teams: Team[] = []): Me => ({ auth, user, teams, can: (need) => !auth || (user !== null && RANK[user.role] >= RANK[need]) });

export const MeContext = createContext<Me>(meOf(false, null));
export const useMe = (): Me => useContext(MeContext);
