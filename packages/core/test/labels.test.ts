/**
 * 이름표 · 걸린 시간(labels.ts) — 화면 · 알림이 같은 말.
 */
import { describe, expect, it } from "vitest";
import { durationText } from "../src/index.ts";

describe("걸린 시간", () => {
  it("★320ms · 4.2초 · 12초 · 1분 5초 · 2분 · 1시간 2분 · 없으면 빈 칸", () => {
    expect(durationText(320)).toBe("320ms");
    expect(durationText(4_210)).toBe("4.2초");
    expect(durationText(12_400)).toBe("12초");
    expect(durationText(65_000)).toBe("1분 5초");
    expect(durationText(120_000)).toBe("2분");
    expect(durationText(3_720_000)).toBe("1시간 2분");
    expect(durationText(null)).toBe("");
    expect(durationText(undefined, "—")).toBe("—");
  });
});
