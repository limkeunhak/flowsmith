/**
 * **엔진 정책** — 이 프로세스에서 무엇을 돌려도 되나. 서버가 띄울 때 한 번 정한다(main.ts · 사내 서버형 PLAN §24).
 *
 *   customCode  커스텀(코드) 노드를 돌리나 — 끄면 그 노드에서 멈춘다(실행 · 점검 · 녹화 재생 모두)
 *   httpGuard   HTTP 요청 노드 · 알림이 부를 주소를 미리 본다 — 서버 자기 자신(127.x · ::1) · 클라우드 메타데이터(169.254.x)
 *               처럼 «안에서만 닿는» 곳을 막는다. 사내 API(10.x · 172.16~31.x · 192.168.x)는 막지 않는다 — 그걸 부르려고 쓴다
 *
 * ★기본은 둘 다 열려 있다(시험 · 이 PC에서 혼자 쓸 때). 사내 서버로 열 때 main.ts가 닫는다.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface EnginePolicy {
  customCode: boolean;
  httpGuard: ((url: URL) => Promise<void>) | null;
}

export const enginePolicy: EnginePolicy = { customCode: true, httpGuard: null };

export function configureEngine(p: Partial<EnginePolicy>): void {
  Object.assign(enginePolicy, p);
}

export class BlockedAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedAddressError";
  }
}

const v4 = (a: string): number => a.split(".").reduce((n, x) => (n << 8) + Number(x), 0) >>> 0;
const inCidr = (addr: string, cidr: string): boolean => {
  const [base, bits] = cidr.split("/");
  const n = Number(bits ?? 32);
  const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
  return (v4(addr) & mask) === (v4(base!) & mask);
};

/** 막는 주소인가 — 막으면 까닭 */
export function blockedAddress(addr: string, extra: readonly string[] = []): string | null {
  let a = addr.toLowerCase();
  if (a.startsWith("::ffff:") && isIP(a.slice(7)) === 4) a = a.slice(7);       // IPv4를 품은 IPv6
  if (isIP(a) === 4) {
    if (inCidr(a, "127.0.0.0/8")) return "서버 자기 자신(127.x)";
    if (inCidr(a, "0.0.0.0/8")) return "쓸 수 없는 주소(0.x)";
    if (inCidr(a, "169.254.0.0/16")) return "클라우드 메타데이터 · 링크 로컬(169.254.x)";
    if (a === "100.100.100.200") return "클라우드 메타데이터";
    for (const c of extra) if (/^\d+\.\d+\.\d+\.\d+(\/\d+)?$/.test(c) && inCidr(a, c.includes("/") ? c : `${c}/32`)) return `관리자가 막은 주소(${c})`;
    return null;
  }
  if (isIP(a) === 6) {
    if (a === "::1" || a === "::") return "서버 자기 자신(::1)";
    if (/^fe[89ab]/.test(a)) return "링크 로컬(fe80::)";
    if (a.startsWith("fd00:ec2:")) return "클라우드 메타데이터";
    return null;
  }
  return null;
}

/**
 * 주소 지킴이를 만든다 — 이름을 풀어 나온 주소가 하나라도 막는 곳이면 던진다.
 * extra — 더 막을 이름 · IPv4(CIDR) — FLOWSMITH_HTTP_DENY
 * ☆이름을 푼 뒤 실제로 붙을 때 다시 풀 수 있다(DNS를 바꿔치기하는 공격) — 완전한 막이는 아니다. 앞단 방화벽이 마지막 벽이다
 */
export function makeHttpGuard(extra: readonly string[] = []): (url: URL) => Promise<void> {
  const names = new Set(extra.filter((x) => !/^\d+\.\d+\.\d+\.\d+(\/\d+)?$/.test(x)).map((x) => x.toLowerCase()));
  return async (url: URL) => {
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost")) throw new BlockedAddressError(`이 주소는 부를 수 없습니다 — 서버 자기 자신(${host})`);
    if (names.has(host)) throw new BlockedAddressError(`이 주소는 부를 수 없습니다 — 관리자가 막은 이름(${host})`);
    const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((x) => x.address);
    for (const a of addrs) {
      const why = blockedAddress(a, extra);
      if (why) throw new BlockedAddressError(`이 주소는 부를 수 없습니다 — ${why}: ${host}`);
    }
  };
}
