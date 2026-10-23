/**
 * 비밀번호 — scrypt(소금 16바이트 · 64바이트). ★비밀번호 자체는 저장하지 않는다. 견줄 때는 시간이 같게(timingSafeEqual).
 *   저장 모양: scrypt$N$r$p$소금(base64)$해시(base64)
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (pw: string, salt: Buffer, len: number, o: ScryptOptions) =>
  new Promise<Buffer>((ok, fail) => scryptCb(pw, salt, len, o, (e, k) => (e ? fail(e) : ok(k))));

const N = 16384, r = 8, p = 1, LEN = 64;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, LEN, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [kind, n, rr, pp, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await scrypt(pw, Buffer.from(salt, "base64"), want.length, { N: Number(n), r: Number(rr), p: Number(pp), maxmem: 64 * 1024 * 1024 });
  return got.length === want.length && timingSafeEqual(got, want);
}

/** 쓸 만한 비밀번호인가 — 아니면 까닭 */
export function weakPassword(pw: string): string | null {
  if (pw.length < 8) return "비밀번호는 8자 이상이어야 합니다";
  if (/^(.)\1+$/.test(pw)) return "같은 글자만 되풀이한 비밀번호는 쓸 수 없습니다";
  if (/^(12345678|password|qwerty)/i.test(pw)) return "너무 흔한 비밀번호입니다";
  return null;
}

/** 관리자가 정해 주는 임시 비밀번호 — 헷갈리는 글자(0 O 1 l I)를 뺀다 */
export function tempPassword(): string {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = randomBytes(12);
  return [...b].map((x) => abc[x % abc.length]).join("").replace(/(.{4})(?!$)/g, "$1-");
}
