/**
 * 화면 규칙(storage/areas.ts) — 초안에서 주소 읽기 · 가장 긴 규칙 · 규칙이 없으면 호스트.
 */
import { describe, expect, it } from "vitest";
import { areaOf, siteFacts, sitePath } from "../src/storage/areas.ts";

const web = (url: unknown, more: Record<string, unknown> = {}) => ({ type: "web", config: { start: url === "continue" ? { kind: "continue" } : { kind: "url", url }, actions: [], ...more } });
const rules = [{ prefix: "qa.msu.io", name: "MSU 웹" }, { prefix: "qa.msu.io/navigator", name: "Navigator" }];

describe("sitePath", () => {
  it("스킴 · 물음표 뒤 · 끝의 / 를 떼고 호스트는 작은 글자 · {{ }} 앞까지", () => {
    expect(sitePath("https://QA.msu.io/navigator/?tab=1#x")).toBe("qa.msu.io/navigator");
    expect(sitePath("https://qa.msu.io{{ $params.path }}")).toBe("qa.msu.io");
    expect(sitePath("https://qa.msu.io/navigator/owner/{{ $params.owner }}")).toBe("qa.msu.io/navigator/owner");
    expect(sitePath("{{ $vars.baseUrl }}/login")).toBeNull();
    expect(sitePath("about:blank")).toBeNull();
    expect(sitePath("qa.msu.io/x")).toBeNull();
    expect(sitePath("qa.msu.io/x", false)).toBe("qa.msu.io/x");
  });
});

describe("areaOf", () => {
  it("★시작 주소에 가장 길게 맞는 규칙 — /navigator는 Navigator, /notices는 MSU 웹", () => {
    expect(areaOf(siteFacts({ nodes: [web("https://qa.msu.io/navigator/nft/1")] }), rules)).toEqual({ area: "Navigator", site: "qa.msu.io/navigator/nft/1" });
    expect(areaOf(siteFacts({ nodes: [web("https://qa.msu.io/notices")] }), rules).area).toBe("MSU 웹");
    // 경계는 마디 — «/navigatorx»는 Navigator가 아니다
    expect(areaOf(siteFacts({ nodes: [web("https://qa.msu.io/navigatorx")] }), rules).area).toBe("MSU 웹");
  });
  it("★시작 주소가 식이거나 앞 화면을 이어 받으면 — 초안에 적힌 주소 중 가장 길게 맞는 것", () => {
    const seeded = { nodes: [{ type: "custom", config: { code: "const base = 'https://qa.msu.io'; fetch(`https://qa.msu.io/navigator/api`)" } }, web("{{ $node.seed.url }}")] };
    expect(areaOf(siteFacts(seeded), rules)).toEqual({ area: "Navigator", site: "qa.msu.io/navigator/api" });
    expect(areaOf(siteFacts({ nodes: [web("continue"), { type: "check", config: { note: "https://qa.msu.io/notices" } }] }), rules).area).toBe("MSU 웹");
  });
  it("규칙에 안 맞으면 호스트(시작 주소 · 없으면 가장 깊은 주소) · 주소가 없으면 null", () => {
    expect(areaOf(siteFacts({ nodes: [web("https://shop.example/a/b")] }), rules)).toEqual({ area: "shop.example", site: "shop.example/a/b" });
    expect(areaOf(siteFacts({ nodes: [{ type: "http", config: { url: "https://api.example/v1" } }] }), [])).toEqual({ area: "api.example", site: "api.example/v1" });
    expect(areaOf(siteFacts({ nodes: [web("about:blank")] }), rules)).toEqual({ area: null, site: null });
  });
});
