/**
 * 토큰 — 로그인 세션 · 설정 토큰 · 웹훅(fsk_) · 워커(fsw_)가 함께 쓴다.
 * ★저장소에는 해시만 둔다. 토큰 자체는 만들 때 한 번만 사람에게 보인다.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 새 토큰 — prefix가 있으면 앞에 붙인다(「fsw_…」 — 어디에 쓰는 토큰인지 사람이 알게) */
export const newToken = (prefix = "", bytes = 24): string => `${prefix}${randomBytes(bytes).toString("base64url")}`;

/** 저장할 해시(sha256, hex) */
export const hashToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

/** 같은가 — 시간으로 새지 않게(길이가 다르면 바로 아니다) */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
