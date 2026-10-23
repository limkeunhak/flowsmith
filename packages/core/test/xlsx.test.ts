/**
 * 엑셀 만들기 — ZIP(stored) 구조 · CRC · 시트 XML · 값의 종류 · 시트 이름 (2026-10-16).
 */
import { describe, expect, it } from "vitest";
import { tablesOf, toXlsx } from "../src/index.ts";

/** stored ZIP 읽기 — 이름 → 내용(글자). CRC도 맞춰 본다 */
function unzip(b: Uint8Array): Map<string, string> {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const dec = new TextDecoder();
  const out = new Map<string, string>();
  let at = 0;
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (x: Uint8Array) => { let c = 0xffffffff; for (const v of x) c = crcTable[(c ^ v) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  while (dv.getUint32(at, true) === 0x04034b50) {
    const size = dv.getUint32(at + 18, true), nameLen = dv.getUint16(at + 26, true), extra = dv.getUint16(at + 28, true);
    const name = dec.decode(b.subarray(at + 30, at + 30 + nameLen));
    const data = b.subarray(at + 30 + nameLen + extra, at + 30 + nameLen + extra + size);
    expect(crc(data), name).toBe(dv.getUint32(at + 14, true));
    out.set(name, dec.decode(data));
    at += 30 + nameLen + extra + size;
  }
  return out;
}

describe("엑셀", () => {
  it("★ZIP · 필요한 부분 · 시트마다 XML — 머리줄은 굵게 · 숫자는 숫자 · 앞의 0은 글자로", () => {
    const files = unzip(toXlsx(tablesOf({ rows: [{ 제목: "날씨 <맑음> & \"좋음\"", 조회: 1234, 코드: "00123", 확인: true, 묶음: { a: 1 } }, { 제목: "비", 조회: 5 }], count: 2 })));
    expect([...files.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]);
    expect(files.get("xl/workbook.xml")).toContain('<sheet name="rows" sheetId="1" r:id="rId1"/>');
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">제목</t></is></c>');
    expect(sheet).toContain("날씨 &lt;맑음&gt; &amp; &quot;좋음&quot;");
    expect(sheet).toContain('<c r="B2"><v>1234</v></c>');
    expect(sheet).toContain('<c r="C2" t="inlineStr"><is><t xml:space="preserve">00123</t></is></c>');
    expect(sheet).toContain('<c r="D2" t="b"><v>1</v></c>');
    expect(sheet).toContain('{&quot;a&quot;:1}');
    expect(sheet).toContain('<row r="3">');                         // 두 번째 행 — 빈 칸은 쓰지 않는다
    expect(sheet).toContain('state="frozen"');                      // 머리줄 고정
  });

  it("목록마다 시트 한 장 · 시트 이름은 엑셀 규칙대로(31자 · 금지 글자 · 겹침) · 없으면 빈 시트 하나", () => {
    expect(tablesOf({ a: [1, 2], b: [], c: "x", d: [{ k: 1 }] }).map((t) => t.name)).toEqual(["a", "d"]);
    const wb = unzip(toXlsx([{ name: "a/b:c", rows: [] }, { name: "a/b:c", rows: [] }, { name: "x".repeat(40), rows: [] }])).get("xl/workbook.xml")!;
    expect(wb).toContain('name="a b c"');
    expect(wb).toContain('name="a b c(2)"');
    expect(wb).toContain(`name="${"x".repeat(31)}"`);
    expect(unzip(toXlsx([])).has("xl/worksheets/sheet1.xml")).toBe(true);
  });
});
