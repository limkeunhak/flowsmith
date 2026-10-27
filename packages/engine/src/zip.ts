/**
 * zip 쓰기(PLAN §52) — 라이브러리 없이 zlib(deflateRaw · crc32)로. 파일을 하나씩 읽어 흘려 쓴다(전부를 메모리에 올리지 않는다).
 *
 *   ★이름은 UTF-8 표시(일반 목적 비트 11)를 켠다 — 한글 이름이 macOS · Windows 탐색기에서 깨지지 않게
 *   ★이미 압축된 것(PDF · 그림 · zip · 오피스 문서)은 그대로 담는다(stored) — 다시 눌러도 거의 안 줄고 시간만 든다
 *   ★ZIP64는 쓰지 않는다 — 65,535개 · 4GB(파일 하나 · 묶음 전체)를 넘으면 까닭과 함께 멈춘다
 */
import { createWriteStream } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";
import { ZIP_LIMITS } from "@flowsmith/core";

const STORED_EXT = /\.(pdf|png|jpe?g|gif|webp|avif|zip|gz|tgz|bz2|xz|7z|rar|mp3|mp4|mov|webm|docx|xlsx|pptx|hwpx)$/iu;

export interface ZipEntry {
  /** zip 안의 이름(「/」로) */
  name: string;
  mtime: Date;
  read(): Promise<Uint8Array>;
}

/** DOS 날짜 · 시각(zip이 쓰는 꼴 — 2초 단위 · 1980년부터) */
function dos(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

export class ZipLimitError extends Error {}

/** entries를 path에 zip으로 쓴다 — 쓴 파일 수 · zip 크기 */
export async function writeZip(path: string, entries: readonly ZipEntry[]): Promise<{ count: number; bytes: number }> {
  if (entries.length > ZIP_LIMITS.maxEntries) throw new ZipLimitError(`묶을 파일이 ${entries.length}개입니다 — ${ZIP_LIMITS.maxEntries}개까지 묶습니다(ZIP64를 쓰지 않습니다). 포함 규칙으로 나눠 묶으세요`);
  const out = createWriteStream(path);
  let offset = 0;
  const write = (b: Uint8Array) => new Promise<void>((ok, fail) => { out.write(b, (e) => (e ? fail(e) : ok())); offset += b.length; });
  const central: Buffer[] = [];
  try {
    for (const e of entries) {
      const data = Buffer.from(await e.read());
      const stored = STORED_EXT.test(e.name);
      const body = stored ? data : deflateRawSync(data);
      // 눌렀는데 더 커지면 그대로 담는다
      const useStored = stored || body.length >= data.length;
      const payload = useStored ? data : body;
      if (data.length > ZIP_LIMITS.maxBytes || offset + payload.length > ZIP_LIMITS.maxBytes) throw new ZipLimitError(`«${e.name}»에서 4GB를 넘습니다 — ZIP64를 쓰지 않습니다. 나눠 묶으세요`);
      const crc = crc32(data) >>> 0;
      const name = Buffer.from(e.name, "utf8");
      const { time, date } = dos(e.mtime);
      const method = useStored ? 0 : 8;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
      local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
      const at = offset;
      await write(local); await write(name); await write(payload);
      const cen = Buffer.alloc(46);
      cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(method, 10);
      cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(payload.length, 20); cen.writeUInt32LE(data.length, 24);
      cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(at, 42);
      central.push(cen, name);
    }
    const cdAt = offset;
    for (const b of central) await write(b);
    const cdSize = offset - cdAt;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(cdAt, 16);
    await write(end);
  } finally {
    await new Promise<void>((ok) => out.end(ok));
  }
  return { count: entries.length, bytes: offset };
}
