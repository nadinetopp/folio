import { describe, expect, it } from "vitest";
import { clipToRegion, tablesFromPages, type PageTableSource } from "./detect";
import type { Cell, Ruling } from "./types";

function cell(text: string, x: number, y: number, w = Math.max(8, text.length * 6), h = 11, page = 1): Cell {
  return { text, x0: x, y0: y, x1: x + w, y1: y + h, page };
}

function grid(): Ruling[] {
  const rules: Ruling[] = [];
  for (const y of [700, 660, 620, 580]) rules.push({ axis: "h", at: y, from: 72, to: 460 });
  for (const x of [72, 220, 320, 460]) rules.push({ axis: "v", at: x, from: 580, to: 700 });
  return rules;
}

function ledger(page: number, data: [string, string, string][]): PageTableSource {
  const cells: Cell[] = [
    cell("Description", 76, 672, 70, 11, page),
    cell("Qty", 224, 672, 20, 11, page),
    cell("Amount", 324, 672, 48, 11, page),
  ];
  data.forEach((row, index) => {
    const y = 632 - index * 40;
    if (row[0]) cells.push(cell(row[0], 76, y, 70, 11, page));
    if (row[1]) cells.push(cell(row[1], 224, y, 12, 11, page));
    if (row[2]) cells.push(cell(row[2], 324, y, 56, 11, page));
  });
  return { page, cells, rulings: grid() };
}

describe("tablesFromPages", () => {
  it("reads a ruled grid, including a wrapped cell and an empty one", () => {
    const source = ledger(1, [["North", "1", "$1,200.00"], ["Tax", "", "$10.00"]]);
    // The second line of the description sits in the same ruled row as "North".
    source.cells = source.cells.filter(item => item.text !== "North");
    source.cells.push(cell("North", 76, 640, 40, 11, 1), cell("lot", 76, 626, 24, 11, 1));
    const [table] = tablesFromPages([source]);
    expect(table.rows).toEqual([
      ["Description", "Qty", "Amount"],
      ["North\nlot", "1", "$1,200.00"],
      ["Tax", "", "$10.00"],
    ]);
  });

  it("stitches a continued table and drops the repeated header", () => {
    const tables = tablesFromPages([
      ledger(1, [["Rent", "1", "$1,200.00"]]),
      ledger(2, [["Water", "1", "$45.50"]]),
    ]);
    expect(tables).toEqual([{
      page: 1,
      pageEnd: 2,
      rows: [
        ["Description", "Qty", "Amount"],
        ["Rent", "1", "$1,200.00"],
        ["Water", "1", "$45.50"],
      ],
    }]);
  });

  it("keeps a heading with the table and drops it when the table continues", () => {
    const withTitle = (page: number, row: [string, string, string]) => {
      const source = ledger(page, [row]);
      source.cells.push(cell("Maple Court rent ledger", 72, 710, 180, 16, page));
      return source;
    };
    const tables = tablesFromPages([
      withTitle(1, ["Rent", "1", "$1,200.00"]),
      withTitle(2, ["Water", "1", "$45.50"]),
    ]);
    expect(tables).toEqual([{
      page: 1,
      pageEnd: 2,
      rows: [
        ["Maple Court rent ledger", "", ""],
        ["Description", "Qty", "Amount"],
        ["Rent", "1", "$1,200.00"],
        ["Water", "1", "$45.50"],
      ],
    }]);
  });

  it("does not stitch a table with a different shape", () => {
    const other: PageTableSource = {
      page: 2,
      rulings: [],
      cells: [
        cell("Note", 72, 700, 40, 11, 2),
        cell("Paid", 200, 700, 40, 11, 2),
        cell("Yes", 72, 680, 30, 11, 2),
        cell("No", 200, 680, 24, 11, 2),
      ],
    };
    const tables = tablesFromPages([ledger(1, [["Rent", "1", "$10.00"]]), other]);
    expect(tables).toHaveLength(2);
    expect(tables[1].rows[0]).toEqual(["Note", "Paid"]);
  });

  it("keeps a paragraph as one column and a later table separate", () => {
    const cells = [
      cell("Notice of rent", 72, 740, 120),
      cell("Maple Court", 72, 724, 80),
      cell("Description", 72, 500, 70),
      cell("Amount", 320, 500, 48),
      cell("Rent", 72, 480, 32),
      cell("$1,200.00", 300, 480, 56),
    ];
    const tables = tablesFromPages([{ page: 4, cells, rulings: [] }]);
    expect(tables.map(table => table.rows)).toEqual([
      [["Notice of rent"], ["Maple Court"]],
      [["Description", "Amount"], ["Rent", "$1,200.00"]],
    ]);
  });

  it("exports only the selected column", () => {
    const source = ledger(1, [["Rent", "1", "$1,200.00"]]);
    const clipped = clipToRegion(source.cells, source.rulings, [[70, 620, 210, 710]]);
    const [table] = tablesFromPages([{ page: 1, ...clipped }]);
    expect(table.rows.every(row => row.length === 1)).toBe(true);
    expect(table.rows.map(row => row[0])).toEqual(["Description", "Rent"]);
  });
});
