/**
 * **빈자리 찾기** — 새 메모를 노드 · 다른 메모와 겹치지 않는 곳에 둔다.
 *
 * 화면 가운데에서 가까운 차례로 격자(20)를 훑어 **보이는 화면 안의** 빈자리를 고른다.
 * 화면에 빈자리가 없으면 그려진 것 전체의 아래에 둔다(그때는 캔버스가 그리로 옮겨 보여 준다).
 */
export interface Box { x: number; y: number; width: number; height: number }

const GRID = 20;
/** 노드 · 메모와 이만큼은 띄운다 */
const GAP = 24;

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width + GAP && b.x < a.x + a.width + GAP && a.y < b.y + b.height + GAP && b.y < a.y + a.height + GAP;

const snap = (v: number): number => Math.round(v / GRID) * GRID;

/** 빈자리(왼쪽 위) · 화면 안에서 찾았나 */
export function freeSpot(taken: readonly Box[], size: { width: number; height: number }, view: Box): { x: number; y: number; inView: boolean } {
  const cx = view.x + view.width / 2 - size.width / 2;
  const cy = view.y + view.height / 2 - size.height / 2;
  const fits = (x: number, y: number) => !taken.some((t) => overlaps({ x, y, ...size }, t));
  const inside = (x: number, y: number) => x >= view.x && y >= view.y && x + size.width <= view.x + view.width && y + size.height <= view.y + view.height;
  const reach = Math.ceil(Math.max(view.width, view.height) / GRID);
  for (let r = 0; r <= reach; r++) {
    // 이 고리의 칸들 — 가운데에서 가까운 차례로
    const ring: { x: number; y: number; d: number }[] = [];
    for (let i = -r; i <= r; i++) {
      for (const [dx, dy] of r === 0 ? [[0, 0]] : [[i, -r], [i, r], [-r, i], [r, i]]) {
        const x = snap(cx + dx! * GRID), y = snap(cy + dy! * GRID);
        ring.push({ x, y, d: Math.hypot(x - cx, y - cy) });
      }
    }
    ring.sort((a, b) => a.d - b.d);
    for (const p of ring) if (inside(p.x, p.y) && fits(p.x, p.y)) return { x: p.x, y: p.y, inView: true };
  }
  // 화면이 꽉 찼다 — 전체 아래 왼쪽
  if (taken.length === 0) return { x: snap(cx), y: snap(cy), inView: true };
  const left = Math.min(...taken.map((t) => t.x));
  const bottom = Math.max(...taken.map((t) => t.y + t.height));
  return { x: snap(left), y: snap(bottom + GAP * 2), inView: false };
}
