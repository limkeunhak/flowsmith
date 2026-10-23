/**
 * 날짜 · 때를 말로 — 화면이 함께 쓴다(걸린 시간은 core의 durationText).
 *   dateTime     10/17 13:29
 *   dateTimeDay  10/17(금) 13:29
 *   ago          방금 · 5분 전 · 3시간 전 · 2026. 10. 15.
 */
const p2 = (n: number) => String(n).padStart(2, "0");
const DAY = ["일", "월", "화", "수", "목", "금", "토"];

export function dateTime(at: string | Date | null | undefined, empty = "—"): string {
  if (!at) return empty;
  const d = typeof at === "string" ? new Date(at) : at;
  return `${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function dateTimeDay(at: string | Date): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return `${d.getMonth() + 1}/${d.getDate()}(${DAY[d.getDay()]}) ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function ago(at: string | null | undefined, empty = "—"): string {
  if (!at) return empty;
  const s = (Date.now() - new Date(at).getTime()) / 1000;
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86_400) return `${Math.floor(s / 3600)}시간 전`;
  return new Date(at).toLocaleDateString("ko-KR");
}
