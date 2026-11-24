import { describe, expect, it } from "vitest";
import { cellsFromItems, clusterRows, joinCellText, layoutRows } from "./items";
import type { Cell } from "./types";

function cell(text: string, x: number, y: number, w = Math.max(8, text.length * 6), h = 11, page = 1): Cell {
  return { text, x0: x, y0: y, x1: x + w, y1: y + h, page };
}

describe("cellsFromItems", () => {
  it("drops the wide space runs pdf.js inserts across a column gap", () => {
    const cells = cellsFromItems([
      { str: "Item", transform: [11, 0, 0, 11, 76, 684], width: 21, height: 11 },
      { str: " ", transform: [11, 0, 0, 11, 97, 684], width: 156, height: 0 },
      { str: "Qty", transform: [11, 0, 0, 11, 254, 684], width: 17, height: 11 },
      { str: "$1,200.00", transform: [11, 0, 0, 11, 364, 662], width: 49, height: 11 },
    ], 2);
    expect(cells.map(item => item.text)).toEqual(["Item", "Qty", "$1,200.00"]);
    expect(cells.every(item => item.page === 2)).toBe(true);
    expect(cells[2].text).toBe("$1,200.00");
  });

  it("ignores marked-content markers", () => {
    expect(cellsFromItems([{ type: "beginMarkedContent" }], 1)).toEqual([]);
  });
});

describe("clusterRows", () => {
  it("keeps a baseline together and starts a new row a line below", () => {
    const rows = clusterRows([
      cell("Qty", 300, 700),
      cell("Item", 72, 698),
      cell("Rent", 72, 676),
    ]);
    expect(rows.map(row => row.map(item => item.text))).toEqual([["Item", "Qty"], ["Rent"]]);
  });
});

describe("joinCellText", () => {
  it("joins words with a space and stacked lines with a newline, without rewriting numbers", () => {
    expect(joinCellText([cell("Monthly", 72, 700, 48), cell("rent", 124, 700, 28)])).toBe("Monthly rent");
    expect(joinCellText([cell("$", 300, 700, 8), cell("1,200.00", 308, 700, 52)])).toBe("$1,200.00");
    expect(joinCellText([cell("North", 72, 640, 40), cell("lot", 72, 626, 24)])).toBe("North\nlot");
  });
});

describe("layoutRows", () => {
  it("lines up a borderless invoice, including a right-aligned amount under a short heading", () => {
    const rows = clusterRows([
      cell("Invoice 1042", 72, 730, 80),
      cell("Description", 72, 700, 70),
      cell("Qty", 300, 700, 22),
      cell("Amount", 400, 700, 48),
      cell("Monthly rent", 72, 680, 78),
      cell("1", 300, 680, 8),
      cell("$1,500.00", 392, 680, 56),
      cell("Late fee", 72, 660, 52),
      cell("1", 300, 660, 8),
      cell("$75.00", 416, 660, 36),
    ]);
    const laid = layoutRows(rows);
    expect(laid.rows).toEqual([
      ["Invoice 1042", "", ""],
      ["Description", "Qty", "Amount"],
      ["Monthly rent", "1", "$1,500.00"],
      ["Late fee", "1", "$75.00"],
    ]);
    expect(laid.anchors).toEqual([72, 300, 400]);
  });

  it("keeps the columns of a single selected row", () => {
    const rows = clusterRows([
      cell("June rent", 72, 640, 70),
      cell("1", 230, 640, 8),
      cell("$1,200.00", 330, 640, 56),
    ]);
    expect(layoutRows(rows).rows).toEqual([["June rent", "1", "$1,200.00"]]);
  });

  it("does not turn one wide gap in a paragraph into columns", () => {
    const rows = clusterRows([
      cell("Hello", 72, 700, 40),
      cell("there", 200, 700, 40),
      cell("A following sentence.", 72, 684, 140),
    ]);
    expect(layoutRows(rows)).toEqual({
      rows: [["Hello there"], ["A following sentence."]],
      anchors: [],
    });
  });

  it("falls back to one column of lines when the text is not a table", () => {
    const rows = clusterRows([
      cell("Invoice for Maple Street", 72, 700, 160),
      cell("Due on receipt", 72, 684, 90),
    ]);
    expect(layoutRows(rows)).toEqual({
      rows: [["Invoice for Maple Street"], ["Due on receipt"]],
      anchors: [],
    });
  });
});
