/**
 * 빈자리 찾기(model/place.ts) — 새 메모가 노드 · 다른 메모와 겹치지 않게.
 */
import { describe, expect, it } from "vitest";
import { freeSpot, type Box } from "../src/model/index.ts";

const size = { width: 260, height: 140 };
const view: Box = { x: 0, y: 0, width: 1200, height: 800 };
const hit = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("freeSpot", () => {
  it("비었으면 화면 가운데", () => {
    expect(freeSpot([], size, view)).toEqual({ x: 480, y: 340, inView: true });
  });

  it("★가운데에 노드가 있으면 겹치지 않는 가장 가까운 자리 — 화면 안", () => {
    const taken: Box[] = [{ x: 500, y: 350, width: 160, height: 150 }, { x: 300, y: 350, width: 160, height: 150 }];
    const at = freeSpot(taken, size, view);
    expect(at.inView).toBe(true);
    const me = { x: at.x, y: at.y, ...size };
    for (const t of taken) expect(hit(me, t)).toBe(false);
    expect(me.x >= 0 && me.y >= 0 && me.x + me.width <= 1200 && me.y + me.height <= 800).toBe(true);
    // 가까운 곳 — 화면 끝으로 밀려나지 않는다
    expect(Math.hypot(at.x - 480, at.y - 340)).toBeLessThan(300);
  });

  it("★화면이 꽉 차면 전체 아래 · inView=false(캔버스가 그리로 옮긴다)", () => {
    const taken: Box[] = [{ x: -100, y: -100, width: 1400, height: 1000 }];
    expect(freeSpot(taken, size, view)).toEqual({ x: -100, y: 940, inView: false });
  });
});
