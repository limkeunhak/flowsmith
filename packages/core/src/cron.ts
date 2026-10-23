/**
 * **cron** — 일정 트리거의 시각 (PLAN §8 M6). 순수하다. 의존성 없이 5칸만.
 *
 *   분(0-59) 시(0-23) 일(1-31) 월(1-12) 요일(0-6, 0과 7은 일요일)
 *   *  ·  1,15  ·  9-18  ·  *\/10  ·  1-5/2
 *
 * ☆일 · 요일이 둘 다 정해지면 «둘 중 하나라도 맞으면»이다(전통 cron과 같다).
 * ☆시각은 서버의 현지 시각(KST)이다.
 */

export class CronError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronError";
  }
}

interface Field { name: string; min: number; max: number }
const FIELDS: Field[] = [
  { name: "분", min: 0, max: 59 },
  { name: "시", min: 0, max: 23 },
  { name: "일", min: 1, max: 31 },
  { name: "월", min: 1, max: 12 },
  { name: "요일", min: 0, max: 7 },
];

export interface Cron {
  minute: Set<number>;
  hour: Set<number>;
  day: Set<number>;
  month: Set<number>;
  weekday: Set<number>;
  /** 일 · 요일이 «*»였나 — 둘 다 정해졌을 때만 «하나라도»가 된다 */
  dayAny: boolean;
  weekdayAny: boolean;
}

function parseField(text: string, f: Field): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new CronError(`${f.name} 칸 "${part}"를 읽을 수 없습니다 — *, 숫자, 1-5, */10 꼴로 씁니다`);
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) throw new CronError(`${f.name} 칸의 간격은 1 이상이어야 합니다`);
    let lo = f.min, hi = f.max;
    if (m[1] !== "*") {
      const [a, b] = m[1]!.split("-").map(Number) as [number, number | undefined];
      lo = a; hi = b ?? (m[2] === undefined ? a : f.max);
    }
    if (lo < f.min || hi > f.max || lo > hi) throw new CronError(`${f.name} 칸 "${part}"가 범위(${f.min}-${f.max})를 벗어납니다`);
    for (let v = lo; v <= hi; v += step) out.add(f.name === "요일" && v === 7 ? 0 : v);
  }
  return out;
}

export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new CronError(`칸이 5개여야 합니다(분 시 일 월 요일) — 받은 것: ${parts.length}개`);
  const [mi, h, d, mo, w] = parts.map((p, i) => parseField(p, FIELDS[i]!)) as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  return { minute: mi, hour: h, day: d, month: mo, weekday: w, dayAny: parts[2] === "*", weekdayAny: parts[4] === "*" };
}

/** 이 분(초는 버린다)에 맞나 */
export function cronMatches(c: Cron, at: Date): boolean {
  if (!c.minute.has(at.getMinutes()) || !c.hour.has(at.getHours()) || !c.month.has(at.getMonth() + 1)) return false;
  const d = c.day.has(at.getDate()), w = c.weekday.has(at.getDay());
  if (c.dayAny && c.weekdayAny) return true;
  if (c.dayAny) return w;
  if (c.weekdayAny) return d;
  return d || w;
}

/** 다음에 돌 시각들 — `from` 다음 분부터 최대 1년을 훑는다 */
export function nextFires(expr: string, from: Date, n = 3): Date[] {
  const c = parseCron(expr);
  const out: Date[] = [];
  const t = new Date(from);
  t.setSeconds(0, 0);
  for (let i = 0; i < 366 * 24 * 60 && out.length < n; i++) {
    t.setMinutes(t.getMinutes() + 1);
    if (cronMatches(c, t)) out.push(new Date(t));
  }
  return out;
}

/** 이 분의 열쇠 — 같은 분에 두 번 돌지 않게 */
export const minuteKey = (at: Date): string =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}T${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;

const WD = ["일", "월", "화", "수", "목", "금", "토"];

/** 사람 말로 — 흔한 꼴만 풀고, 나머지는 칸마다 적는다 */
export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  parseCron(expr);   // 틀렸으면 던진다
  const [mi, h, d, mo, w] = parts as [string, string, string, string, string];
  const list = (s: string, unit: string, names?: string[]) => {
    if (s === "*") return "";
    const step = /^\*\/(\d+)$/.exec(s);
    if (step) return `${step[1]}${unit}마다`;
    return s.split(",").map((p) => p.split("-").map((x) => (names ? names[Number(x) % 7] : x)).join("~")).join(", ") + (names ? "" : unit);
  };
  const days = w === "1-5" ? "평일" : w === "0,6" || w === "6,0" ? "주말" : w === "*" ? "" : `${list(w, "", WD)}요일`;
  const when = [mo !== "*" ? list(mo, "월") : "", d !== "*" ? list(d, "일") : "", days].filter(Boolean).join(" ");
  let time: string;
  if (/^\d+$/.test(h) && /^\d+$/.test(mi)) time = `${h}시${mi === "0" ? "" : ` ${mi}분`}`;
  else if (h === "*" && /^\*\/\d+$/.test(mi)) time = list(mi, "분");
  else if (h === "*" && /^\d+$/.test(mi)) time = mi === "0" ? "매시 정각" : `매시 ${mi}분`;
  else time = [h !== "*" ? list(h, "시") : "매시", mi !== "*" ? list(mi, "분") : "매분"].join(" ");
  // 시간마다 · 분마다 도는 것은 «매일»을 붙이지 않는다 — 「매일 30분마다」보다 「30분마다」
  return `${when || (h === "*" ? "" : "매일")} ${time}`.trim();
}
