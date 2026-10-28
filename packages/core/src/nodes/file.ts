/**
 * **파일 쓰기 노드** — 앞 노드가 모은 것을 저장소에 쓴다. 지금은 로컬 파일만(DB · S3는 같은 자리에 종류로 더한다).
 *
 * 여기는 순수한 부분만 — 모델 · 파일 이름 짓기(롤링) · 이름 검사. 실제로 쓰고 읽는 것은 엔진(nodes/file-write-node.ts · file-read-node.ts)이고,
 * 편집 화면은 같은 함수로 «이번에 쓸 파일 이름»을 미리 보여 준다.
 *
 *   롤링 없음      output.csv
 *   시간(일)       output-20261015.csv   — 같은 날 다시 돌면 거기에 이어 붙는다. 16일이 되면 output-20261016.csv
 *   시간(시 · 월)  output-20261015-09.csv · output-202610.csv
 *   번호           output-0001.csv       — 실행마다 · 행 수가 차면 · 크기가 차면 다음 번호
 *
 * ★시각은 서버의 시각(일정 트리거와 같다).
 *
 * 폴더 — 플로우마다 따로(`files/<플로우 uuid>/…`). uuid는 서버가 플로우를 만들 때 붙이고 매니페스트(JSON)에는 없다 —
 *  JSON을 복사해 새 플로우를 만들어도 새 uuid라 같은 파일에 섞여 쓰지 않는다.
 *  여러 플로우가 **일부러** 한 파일에 모을 때만 공유 폴더(`files/shared/…`)를 고른다.
 */

export const STORE_KINDS = ["file"] as const;
export type StoreKind = (typeof STORE_KINDS)[number];

export const STORE_FORMATS = ["csv", "jsonl", "json", "text"] as const;
export type StoreFormat = (typeof STORE_FORMATS)[number];

/** 어느 폴더 아래 — 이 플로우의 폴더 · 공유 폴더 */
export const STORE_SCOPES = ["flow", "shared"] as const;
export type StoreScope = (typeof STORE_SCOPES)[number];
/** 공유 폴더의 이름(파일 뿌리 아래) */
export const SHARED_DIR = "shared";

export const WRITE_MODES = ["append", "overwrite"] as const;
export type WriteMode = (typeof WRITE_MODES)[number];

export const TIME_UNITS = ["hour", "day", "month"] as const;
export type TimeUnit = (typeof TIME_UNITS)[number];

/** 번호 롤링이 다음 번호로 넘어가는 때 — 실행마다 · 행이 limit개를 넘으면 · 파일이 limit바이트를 넘으면 */
export const SEQUENCE_EVERY = ["run", "rows", "bytes"] as const;
export type SequenceEvery = (typeof SEQUENCE_EVERY)[number];

export type Rolling =
  | { kind: "none" }
  | { kind: "time"; unit: TimeUnit }
  | { kind: "sequence"; every: SequenceEvery; limit: number | null };

export interface FileStoreTarget {
  kind: "file";
  /** 이 플로우의 폴더(files/<uuid>) 아래인가 · 공유 폴더(files/shared) 아래인가 */
  scope: StoreScope;
  /** 그 아래의 하위 폴더(상대 경로). 비우면 바로 아래 */
  dir: string;
  /** 파일 이름의 앞부분 — 「output」. 확장자와 롤링 꼬리는 붙여 준다 */
  name: string;
  format: StoreFormat;
  mode: WriteMode;
  rolling: Rolling;
  /** CSV — 머리줄 · 엑셀이 한글을 읽게 BOM · 열 순서(비우면 들어온 값의 이름 순서) */
  csv: { header: boolean; bom: boolean; columns: string[] | null };
  /** 이미 그 파일에 있는 값이면 건너뛴다 — 이 이름의 값으로 견준다(「링크」). 텍스트는 줄 전체로 */
  dedupeKey: string | null;
  /** 값마다 수집 시각을 붙인다 — 이 이름의 칸으로(「수집시각」) */
  stampColumn: string | null;
  /** n일 지난 파일 지우기 — 쓴 뒤 이 노드의 파일(같은 폴더 · 같은 이름 꼴) 중 오래된 것을 지운다. null이면 두기 */
  keepDays: number | null;
}

export type StoreTarget = FileStoreTarget;

export interface StoreConfig {
  /** 저장할 값 — 「{{ $input.news }}」. 목록이면 항목마다 한 줄 · 객체 하나면 한 줄 */
  data: string;
  target: StoreTarget;
}

/** 파일 쓰기 노드가 내보내는 것 — 뒤 노드가 «어느 파일에 몇 개» 를 쓸 수 있다 */
export const STORE_OUTPUTS = ["file", "written", "skipped"] as const;

/**
 * 빠진 칸을 기본값으로 — 초안은 검문소를 안 거친 채 저장된다(손으로 고친 JSON · 옛 초안). 화면이 이것으로 받아 쓴다
 */
export function withStoreDefaults(c: Partial<StoreConfig> | undefined): StoreConfig {
  const t = (c?.target ?? {}) as Partial<FileStoreTarget>;
  return {
    data: c?.data ?? "",
    target: {
      kind: "file", scope: t.scope ?? "flow", dir: t.dir ?? "", name: t.name ?? "output", format: t.format ?? "csv", mode: t.mode ?? "append",
      rolling: t.rolling ?? { kind: "none" },
      csv: { header: t.csv?.header ?? true, bom: t.csv?.bom ?? true, columns: t.csv?.columns ?? null },
      dedupeKey: t.dedupeKey ?? null, stampColumn: t.stampColumn ?? null, keepDays: t.keepDays ?? null,
    },
  };
}

export const FORMAT_EXT: Record<StoreFormat, string> = { csv: "csv", jsonl: "jsonl", json: "json", text: "txt" };

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** 시간 꼬리 — 서버 시각으로 */
export function timeSuffix(unit: TimeUnit, d: Date): string {
  const day = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return unit === "month" ? day.slice(0, 6) : unit === "day" ? day : `${day}-${pad(d.getHours())}`;
}

export const seqSuffix = (n: number): string => pad(n, 4);

/** 이번에 쓸 파일 이름 — 번호 롤링은 번호를 받는다(몇 번인지는 폴더를 봐야 안다) */
export function fileNameFor(t: FileStoreTarget, now: Date, seq = 1): string {
  const ext = FORMAT_EXT[t.format];
  switch (t.rolling.kind) {
    case "none": return `${t.name}.${ext}`;
    case "time": return `${t.name}-${timeSuffix(t.rolling.unit, now)}.${ext}`;
    case "sequence": return `${t.name}-${seqSuffix(seq)}.${ext}`;
  }
}

/** 번호 롤링 파일인가 — 그렇다면 번호 */
export function seqOf(t: FileStoreTarget, fileName: string): number | null {
  const ext = FORMAT_EXT[t.format];
  const m = new RegExp(`^${escapeRe(t.name)}-(\\d{4,})\\.${ext}$`, "u").exec(fileName);
  return m ? Number(m[1]) : null;
}

/** 이 파일 쓰기 노드가 만드는 파일들인가(롤링 꼬리를 감안해) — 화면이 «저장된 파일»을 고르는 데 */
export function belongsTo(t: FileStoreTarget, fileName: string): boolean {
  const ext = FORMAT_EXT[t.format];
  return new RegExp(`^${escapeRe(t.name)}(-[0-9-]+)?\\.${ext}$`, "u").test(fileName);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 파일 이름 앞부분 — 폴더 구분자 · 윈도에서 못 쓰는 글자 · 「..」를 막는다 */
export function badFileName(name: string): string | null {
  if (name.trim() === "") return "파일 이름이 비었습니다";
  if (name.length > 100) return "파일 이름이 너무 깁니다(100자까지)";
  if (/[\\/:*?"<>|\u0000-\u001f]/u.test(name)) return "파일 이름에 \\ / : * ? \" < > | 는 쓸 수 없습니다";
  if (name === "." || name === ".." || name.startsWith(".")) return "파일 이름은 점(.)으로 시작할 수 없습니다";
  return null;
}

/** 폴더 — 파일 뿌리 아래의 상대 경로만. 절대 경로 · 「..」 · 숨은 폴더는 막는다 */
export function badDir(dir: string): string | null {
  if (dir === "") return null;
  if (/^[\\/]|^[a-zA-Z]:/.test(dir)) return "폴더는 파일 뿌리 아래의 상대 경로로 씁니다(절대 경로 안 됨)";
  for (const seg of dir.split("/")) {
    if (seg === "") return "폴더 경로에 빈 칸(//)이 있습니다";
    if (seg === ".." || seg === ".") return "폴더 경로에 「..」 · 「.」는 쓸 수 없습니다";
    const bad = badFileName(seg);
    if (bad) return `폴더 이름 「${seg}」: ${bad.replace("파일 이름", "폴더 이름")}`;
  }
  return null;
}

/** 롤링을 사람 말로 */
export function describeRolling(r: Rolling): string {
  switch (r.kind) {
    case "none": return "롤링 없음 — 늘 같은 파일";
    case "time": return { hour: "시간마다 새 파일", day: "날마다 새 파일", month: "달마다 새 파일" }[r.unit];
    case "sequence": return r.every === "run" ? "실행마다 새 번호"
      : r.every === "rows" ? `${r.limit ?? "?"}행이 넘으면 새 번호` : `${r.limit ?? "?"}바이트가 넘으면 새 번호`;
  }
}

// ─── 파일 읽기 ───────────────────────────────────────────────────────
//
// 다른 플로우가 파일 쓰기 노드로 쓴 것을 읽는다. 폴더는 쓰기와 같은 규칙 —
// 이 플로우 폴더 · 공유 폴더 · **다른 플로우의 폴더**(그 플로우의 uuid는 서버가 안다).

export const READ_SCOPES = ["flow", "shared", "otherFlow"] as const;
export type ReadScope = (typeof READ_SCOPES)[number];

/**
 * 어느 파일을 — 이름 그대로 · 시간 롤링 파일(이번 기간이면 0, 지난 기간이면 -1 → 「어제 파일」) · 가장 최근 파일
 */
export type ReadPick =
  | { kind: "fixed" }
  | { kind: "time"; unit: TimeUnit; offset: number }
  | { kind: "latest" };

export interface FileReadSource {
  scope: ReadScope;
  /** 다른 플로우의 폴더를 읽을 때 그 플로우의 id */
  flowId: string | null;
  dir: string;
  name: string;
  format: StoreFormat;
  pick: ReadPick;
  /** CSV 첫 줄이 열 이름인가 — 아니면 열1 · 열2 … */
  csv: { header: boolean };
}

export interface FileReadConfig {
  source: FileReadSource;
  /** 파일이 없으면 — 멈춘다 · 빈 목록으로 간다 */
  missing: "fail" | "empty";
  /** 최대 몇 줄까지(앞에서부터). 없으면 다 */
  maxRows: number | null;
}

export const FILE_READ_OUTPUTS = ["rows", "file", "count"] as const;

/** 기간을 옮긴다 — 「어제」 · 「지난달」 */
export function shiftPeriod(d: Date, unit: TimeUnit, offset: number): Date {
  const x = new Date(d.getTime());
  if (unit === "hour") x.setHours(x.getHours() + offset);
  else if (unit === "day") x.setDate(x.getDate() + offset);
  else { x.setDate(1); x.setMonth(x.getMonth() + offset); }
  return x;
}

/** 읽을 파일 이름 — 「가장 최근」은 폴더를 봐야 알아서 null */
export function readFileName(s: FileReadSource, now: Date): string | null {
  const ext = FORMAT_EXT[s.format];
  switch (s.pick.kind) {
    case "fixed": return `${s.name}.${ext}`;
    case "time": return `${s.name}-${timeSuffix(s.pick.unit, shiftPeriod(now, s.pick.unit, s.pick.offset))}.${ext}`;
    case "latest": return null;
  }
}

/** 가장 최근 파일 — 롤링 꼬리(날짜 · 번호)가 큰 것. 꼬리 없는 파일만 있으면 그것 */
export function latestOf(s: Pick<FileReadSource, "name" | "format">, names: readonly string[]): string | null {
  const ext = FORMAT_EXT[s.format];
  const mine = names.filter((n) => belongsTo({ name: s.name, format: s.format } as FileStoreTarget, n));
  const rolled = mine.filter((n) => n !== `${s.name}.${ext}`).sort();
  return rolled.at(-1) ?? (mine.includes(`${s.name}.${ext}`) ? `${s.name}.${ext}` : null);
}

export function describePick(p: ReadPick): string {
  if (p.kind === "fixed") return "이름 그대로";
  if (p.kind === "latest") return "가장 최근 파일";
  const unit = { hour: "시간", day: "날", month: "달" }[p.unit];
  const when = p.offset === 0 ? `이번 ${unit}` : p.offset === -1 ? { hour: "지난 시간", day: "어제", month: "지난달" }[p.unit] : `${-p.offset}${unit === "날" ? "일" : unit === "달" ? "달" : "시간"} 전`;
  return `${when} 파일`;
}

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/** 경로 마디마다 파일 이름에 못 쓰는 글자를 바꾼다(제목이 그대로 파일 이름이 된다) — 「..」 · 빈 마디도 막는다 */
export function safeFilePath(rel: string): string {
  const parts = rel.split("/").filter((p) => p.trim() !== "").map((p) => {
    let s = p.replace(/[\\:*?"<>|\u0000-\u001f]/gu, "_").replace(/\s+/gu, " ").trim().replace(/[. ]+$/u, "");
    if (s === "" || s === "." || s === "..") s = "_";
    // 너무 긴 이름은 자른다(확장자는 남긴다) — 디스크 · 압축 도구가 255바이트를 넘기면 못 다룬다
    if (utf8Bytes(s) > 180) {
      const ext = /\.[A-Za-z0-9]{1,8}$/u.exec(s)?.[0] ?? "";
      let base = s.slice(0, s.length - ext.length);
      while (utf8Bytes(base + ext) > 180) base = base.slice(0, -1);
      s = base.trimEnd() + ext;
    }
    return s;
  });
  return parts.length ? parts.join("/") : "_";
}
