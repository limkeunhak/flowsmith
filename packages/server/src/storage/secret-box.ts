/**
 * **시크릿을 잠그는 상자** — AES-256-GCM (PLAN §7).
 *
 * ★★마스터 키가 없으면 **서버가 안 뜬다.** 평문으로 흘려 두느니 «못 뜹니다»가 낫다
 *  («잠글 수 없으면 안 적는다»). 키를 자동으로 만들어 DB 옆에 두지도 않는다 —
 *  그러면 DB를 가져간 사람이 키도 같이 가져간다.
 *
 * ★잠글 때 `플로우 id/시크릿 이름`을 AAD로 묶는다. 같은 키라도 A 플로우의 암호문을 B 플로우 자리에
 *  옮겨 넣으면 풀리지 않는다 — DB 행을 바꿔치기해 다른 플로우의 비밀번호를 쓰게 하는 길을 막는다.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class MasterKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterKeyError";
  }
}

export class SecretOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretOpenError";
  }
}

export const KEY_HELP = `마스터 키가 없습니다 — 시크릿을 잠글 수 없으면 서버는 뜨지 않습니다.
  키 만들기:   node packages/server/src/main.ts keygen > ~/.flowsmith.key && chmod 600 ~/.flowsmith.key
  키 주기:     FLOWSMITH_MASTER_KEY_FILE=~/.flowsmith.key  (또는 FLOWSMITH_MASTER_KEY=<base64>)
  ★키를 잃으면 저장한 시크릿을 다시 풀 수 없습니다. 데이터 폴더와 다른 곳에 따로 보관하세요.`;

export function generateKey(): string {
  return randomBytes(32).toString("base64");
}

export class SecretBox {
  readonly #key: Buffer;

  constructor(keyBase64: string) {
    const key = Buffer.from(keyBase64.trim(), "base64");
    if (key.length !== 32) throw new MasterKeyError(`마스터 키는 base64로 된 32바이트여야 합니다(받은 것: ${key.length}바이트)`);
    this.#key = key;
  }

  /** 환경변수에서 — FLOWSMITH_MASTER_KEY 또는 FLOWSMITH_MASTER_KEY_FILE */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): SecretBox {
    const inline = env["FLOWSMITH_MASTER_KEY"];
    const file = env["FLOWSMITH_MASTER_KEY_FILE"];
    if (inline) return new SecretBox(inline);
    if (file) {
      let text: string;
      try { text = readFileSync(file, "utf8"); } catch (e) { throw new MasterKeyError(`마스터 키 파일을 읽을 수 없습니다: ${file} — ${(e as Error).message}`); }
      return new SecretBox(text);
    }
    throw new MasterKeyError(KEY_HELP);
  }

  seal(plain: string, aad: string): string {
    const iv = randomBytes(IV_BYTES);
    const c = createCipheriv("aes-256-gcm", this.#key, iv);
    c.setAAD(Buffer.from(aad, "utf8"));
    const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return `${VERSION}:${Buffer.concat([iv, c.getAuthTag(), body]).toString("base64")}`;
  }

  open(sealed: string, aad: string): string {
    const [ver, b64] = sealed.split(":", 2);
    if (ver !== VERSION || b64 === undefined) throw new SecretOpenError("모르는 형식의 암호문입니다");
    const raw = Buffer.from(b64, "base64");
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const body = raw.subarray(IV_BYTES + TAG_BYTES);
    try {
      const d = createDecipheriv("aes-256-gcm", this.#key, iv);
      d.setAAD(Buffer.from(aad, "utf8"));
      d.setAuthTag(tag);
      return Buffer.concat([d.update(body), d.final()]).toString("utf8");
    } catch {
      // ★어느 쪽인지 가르지 않는다 — 키가 바뀌었거나, 행이 다른 자리에서 옮겨졌거나, 깨졌다
      throw new SecretOpenError("시크릿을 풀 수 없습니다 — 마스터 키가 바뀌었거나 저장된 값이 손상됐습니다");
    }
  }
}
