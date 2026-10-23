import { describe, expect, it } from "vitest";
import { compareFingerprint, reportStatus, type Fingerprint, type ProbeFinding } from "../src/index.ts";

const fp = (o: Partial<Fingerprint> = {}): Fingerprint => ({ tag: "button", attrs: { type: "submit" }, text: "조회", nearText: "취소 포함", ...o });

describe("지문 비교", () => {
  it("그대로면 다른 점이 없다 — class는 안 본다", () => {
    expect(compareFingerprint(fp({ attrs: { type: "submit", class: "a" } }), fp({ attrs: { type: "submit", class: "b" } }), false)).toEqual([]);
  });

  it("★누르는 것의 글자가 바뀌면 알린다", () => {
    expect(compareFingerprint(fp(), fp({ text: "삭제" }), false)).toEqual(["글자: '조회' → '삭제'"]);
  });

  it("★읽는 요소의 글자는 값이라 안 본다 — 이름표는 본다", () => {
    const before = fp({ tag: "b", attrs: { id: "order-status" }, text: "배송중", nearText: "상태:" });
    expect(compareFingerprint(before, { ...before, text: "취소" }, true)).toEqual([]);
    expect(compareFingerprint(before, { ...before, nearText: "결제 수단:" }, true)).toEqual(["이름표: '상태:' → '결제 수단:'"]);
  });

  it("뜻을 지는 속성 · 요소 종류", () => {
    const d = compareFingerprint(fp({ tag: "input", attrs: { id: "uid", name: "uid", type: "text" } }), fp({ tag: "input", attrs: { id: "user", name: "uid", type: "email" } }), false);
    expect(d).toEqual(["id: 'uid' → 'user'", "종류(type): 'text' → 'email'"]);
    expect(compareFingerprint(fp(), fp({ tag: "a" }), false)[0]).toBe("요소 종류: button → a");
  });

  it("링크는 경로만 본다 — 쿼리는 매번 다르다", () => {
    expect(compareFingerprint(fp({ tag: "a", attrs: { href: "/orders?t=1" }, text: "" }), fp({ tag: "a", attrs: { href: "/orders?t=2" }, text: "" }), false)).toEqual([]);
  });

  it("녹화 때 지문이 없으면 견줄 것이 없다", () => {
    expect(compareFingerprint(null, fp(), false)).toEqual([]);
  });

  it("보고서 상태 — 못 찾음 · 여러 개는 깨짐, 달라짐은 바뀜", () => {
    const f = (status: ProbeFinding["status"]) => ({ status } as ProbeFinding);
    expect(reportStatus([f("ok"), f("changed")])).toBe("changed");
    expect(reportStatus([f("changed"), f("missing")])).toBe("broken");
    expect(reportStatus([f("ok")])).toBe("ok");
  });
});
