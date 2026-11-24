import { describe, expect, it } from "vitest";
import { escapeCsvField, toCsv } from "./write";
import type { CsvTable } from "./types";

const table = (page: number, rows: string[][], pageEnd = page): CsvTable => ({ page, pageEnd, rows });

describe("escapeCsvField", () => {
  it("leaves plain text, numbers, and currency without a comma alone", () => {
    expect(escapeCsvField("Rent")).toBe("Rent");
    expect(escapeCsvField("1500.00")).toBe("1500.00");
    expect(escapeCsvField("$75.00")).toBe("$75.00");
    expect(escapeCsvField("")).toBe("");
  });

  it("quotes commas, quotes, and line breaks, and doubles an embedded quote", () => {
    expect(escapeCsvField("$1,200.00")).toBe('"$1,200.00"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("north\nlot")).toBe('"north\nlot"');
    expect(escapeCsvField("a\r\nb")).toBe('"a\r\nb"');
  });
});

describe("toCsv", () => {
  it("writes one table with CRLF and no label, and can prefix a UTF-8 BOM", () => {
    const csv = toCsv([table(1, [["Item", "Amount"], ["Rent", "$1,200.00"]])], true);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.slice(1)).toBe('Item,Amount\r\nRent,"$1,200.00"\r\n');
  });

  it("separates later tables with a blank line and a label row", () => {
    const csv = toCsv([
      table(1, [["Item", "Qty"], ["Rent", "1"]], 2),
      table(3, [["Note"], ["Due on receipt"]]),
    ], false);
    expect(csv).toBe("Item,Qty\r\nRent,1\r\n\r\nTable 2 (page 3)\r\nNote\r\nDue on receipt\r\n");
  });

  it("names a continued table by the pages it covers when it is not the first", () => {
    const csv = toCsv([
      table(1, [["Intro"]]),
      table(2, [["A", "B"]], 4),
    ], false);
    expect(csv).toContain("Table 2 (pages 2-4)\r\n");
  });

  it("returns an empty string when there is nothing to write, BOM included", () => {
    expect(toCsv([], true)).toBe("");
    expect(toCsv([table(1, [["", ""]])], true)).toBe("");
  });
});
