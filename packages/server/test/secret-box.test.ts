import { describe, expect, it } from "vitest";
import { generateKey, MasterKeyError, SecretBox, SecretOpenError } from "../src/storage/secret-box.ts";

describe("시크릿 상자", () => {
  const box = new SecretBox(generateKey());

  it("잠그고 푼다 — 같은 값도 잠글 때마다 다르다", () => {
    const a = box.seal("p@ss", "f/shop");
    const b = box.seal("p@ss", "f/shop");
    expect(a).not.toBe(b);
    expect(a).not.toContain("p@ss");
    expect(box.open(a, "f/shop")).toBe("p@ss");
  });

  it("★다른 자리(AAD)로 옮긴 암호문은 풀리지 않는다", () => {
    const sealed = box.seal("p@ss", "flow-a/shop");
    expect(() => box.open(sealed, "flow-b/shop")).toThrow(SecretOpenError);
  });

  it("다른 키로는 풀리지 않는다", () => {
    const sealed = box.seal("p@ss", "f/shop");
    expect(() => new SecretBox(generateKey()).open(sealed, "f/shop")).toThrow(/마스터 키가 바뀌었거나/);
  });

  it("암호문을 한 글자만 바꿔도 풀리지 않는다", () => {
    const sealed = box.seal("p@ss", "f/shop");
    const raw = Buffer.from(sealed.slice(3), "base64");
    raw[raw.length - 1]! ^= 1;
    expect(() => box.open(`v1:${raw.toString("base64")}`, "f/shop")).toThrow(SecretOpenError);
  });

  it("★키가 없으면 만드는 법을 알려 주며 던진다 — 스스로 키를 만들지 않는다", () => {
    expect(() => SecretBox.fromEnv({})).toThrow(MasterKeyError);
    expect(() => SecretBox.fromEnv({})).toThrow(/keygen/);
  });

  it("키 길이가 틀리면 거부한다", () => {
    expect(() => new SecretBox(Buffer.alloc(16).toString("base64"))).toThrow(/32바이트/);
  });
});
