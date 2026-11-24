// Turn pdf.js text runs into rows and columns. Currency and other strings are copied as they stand.
import { boxOf } from "../ocr/text/geometry";
import type { TextItem } from "../ocr/types";
import type { Cell } from "./types";

/** The fields pdf.js puts on a text run. Marked-content markers have none of these. */
export interface PdfTextRun {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
  hasEOL?: boolean;
}

export function isPdfTextRun(item: unknown): item is PdfTextRun {
  if (!item || typeof item !== "object" || !("str" in item)) return false;
  const run = item as PdfTextRun;
  return typeof run.str === "string" && Array.isArray(run.transform) && run.transform.length >= 6;
}

/**
 * Visible runs only. pdf.js inserts a space run whose width is the whole gap to the next word, including a column
 * gap, so those runs would glue two columns into one cell.
 */
export function cellsFromItems(items: readonly unknown[], page: number): Cell[] {
  const cells: Cell[] = [];
  for (const item of items) {
    if (!isPdfTextRun(item) || !item.str.trim()) continue;
    const asItem: TextItem = {
      str: item.str, dir: "ltr", fontName: item.fontName ?? "", hasEOL: !!item.hasEOL,
      transform: item.transform, width: item.width, height: item.height,
    };
    const [x0, y0, x1, y1] = boxOf(asItem);
    if (!(x1 > x0) && !(y1 > y0)) continue;
    cells.push({ text: item.str, x0, y0, x1, y1, page });
  }
  return cells;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

function centerY(cell: Cell): number {
  return (cell.y0 + cell.y1) / 2;
}

/** Rows from the top of the page down. Items within about half a line of each other share a row. */
export function clusterRows(cells: readonly Cell[], yTolerance?: number): Cell[][] {
  if (!cells.length) return [];
  const heights = cells.map(cell => cell.y1 - cell.y0).filter(height => height > 0);
  const tolerance = yTolerance ?? Math.max(2, (median(heights) || 10) * 0.55);
  const sorted = [...cells].sort((a, b) => centerY(b) - centerY(a) || a.x0 - b.x0);
  const rows: { y: number; cells: Cell[] }[] = [];
  for (const cell of sorted) {
    const y = centerY(cell);
    let best: { y: number; cells: Cell[] } | undefined;
    let bestDist = tolerance;
    for (const row of rows) {
      const dist = Math.abs(row.y - y);
      if (dist <= bestDist) { best = row; bestDist = dist; }
    }
    // Keep the first item's y. Averaging would walk the row down into the line below it.
    if (best) best.cells.push(cell);
    else rows.push({ y, cells: [cell] });
  }
  rows.sort((a, b) => b.y - a.y);
  for (const row of rows) row.cells.sort((a, b) => a.x0 - b.x0 || b.y0 - a.y0);
  return rows.map(row => row.cells);
}

/** Words on one line, or stacked lines inside one ruled cell, joined without changing the characters. */
export function joinCellText(cells: readonly Cell[]): string {
  if (!cells.length) return "";
  const heights = cells.map(cell => cell.y1 - cell.y0).filter(height => height > 0);
  const lineTolerance = Math.max(2, (median(heights) || 10) * 0.45);
  return clusterRows(cells, lineTolerance).map(line => {
    const sorted = [...line].sort((a, b) => a.x0 - b.x0);
    let text = "";
    let edge = -Infinity;
    let height = 10;
    for (const cell of sorted) {
      const piece = cell.text.trim();
      if (!piece) continue;
      const gap = cell.x0 - edge;
      height = Math.max(height, cell.y1 - cell.y0);
      // A real word space is a gap. A kerning overlap is not, so "$" and "12" stay "$12" when a file splits them.
      if (text && gap > Math.max(0.6, height * 0.06)) text += " ";
      text += piece;
      edge = Math.max(edge, cell.x1);
    }
    return text;
  }).filter(Boolean).join("\n");
}

/** Vertical gaps wider than a blank line start a new block (a heading above a table, or two tables). */
export function splitRowBlocks(rows: readonly Cell[][]): Cell[][][] {
  if (!rows.length) return [];
  const mid = (row: Cell[]) => median(row.map(centerY));
  const ys = rows.map(mid);
  const gaps: number[] = [];
  for (let i = 1; i < ys.length; i++) gaps.push(ys[i - 1] - ys[i]);
  const ordinary = gaps.filter(gap => gap > 0 && gap < 48);
  const pitch = median(ordinary) || median(gaps.filter(gap => gap > 0)) || 12;
  const blocks: Cell[][][] = [[rows[0]]];
  for (let i = 1; i < rows.length; i++) {
    if (ys[i - 1] - ys[i] > pitch * 2.5) blocks.push([]);
    blocks[blocks.length - 1].push(rows[i]);
  }
  return blocks;
}

function columnGap(rows: readonly Cell[][]): number {
  const gaps: number[] = [];
  const heights: number[] = [];
  for (const row of rows) {
    for (const cell of row) if (cell.y1 > cell.y0) heights.push(cell.y1 - cell.y0);
    const sorted = [...row].sort((a, b) => a.x0 - b.x0);
    for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i].x0 - sorted[i - 1].x1);
  }
  if (!gaps.length) return Number.POSITIVE_INFINITY;
  const floor = Math.max(16, (median(heights) || 10) * 1.25);
  const sorted = [...gaps].sort((a, b) => a - b);
  const small = sorted.filter(gap => gap < floor);
  const large = sorted.filter(gap => gap >= floor);
  if (!large.length) return Number.POSITIVE_INFINITY;
  // No word-sized gaps: each run is already its own column.
  if (!small.length) return floor;
  const jump = large[0] - small[small.length - 1];
  if (large[0] < small[small.length - 1] * 1.7 && jump < floor) return Number.POSITIVE_INFINITY;
  return (small[small.length - 1] + large[0]) / 2;
}

function splitByGap(row: readonly Cell[], gap: number): Cell[][] {
  const sorted = [...row].sort((a, b) => a.x0 - b.x0);
  const groups: Cell[][] = [];
  for (const cell of sorted) {
    const previous = groups.at(-1)?.at(-1);
    if (!previous || cell.x0 - previous.x1 >= gap) groups.push([cell]);
    else groups[groups.length - 1].push(cell);
  }
  return groups;
}

function unionCell(cells: Cell[]): Cell {
  return {
    text: joinCellText(cells),
    x0: Math.min(...cells.map(cell => cell.x0)),
    y0: Math.min(...cells.map(cell => cell.y0)),
    x1: Math.max(...cells.map(cell => cell.x1)),
    y1: Math.max(...cells.map(cell => cell.y1)),
    page: cells[0].page,
  };
}

function overlapScore(cell: Cell, column: { x0: number; x1: number }): number {
  const overlap = Math.min(cell.x1, column.x1) - Math.max(cell.x0, column.x0);
  if (overlap <= 0) return 0;
  const width = Math.min(cell.x1 - cell.x0, column.x1 - column.x0);
  return width > 0 ? overlap / width : 0;
}

function assignColumns(row: readonly Cell[], columns: { x0: number; x1: number }[]): string[] {
  const out = columns.map(() => "");
  const used = new Set<number>();
  for (const cell of [...row].sort((a, b) => a.x0 - b.x0)) {
    let best = -1;
    let bestScore = 0.3;
    columns.forEach((column, index) => {
      if (used.has(index)) return;
      const score = overlapScore(cell, column);
      if (score > bestScore) { best = index; bestScore = score; }
    });
    if (best < 0) {
      const x = (cell.x0 + cell.x1) / 2;
      let dist = Infinity;
      columns.forEach((column, index) => {
        if (used.has(index)) return;
        const next = Math.abs(x - (column.x0 + column.x1) / 2);
        if (next < dist) { dist = next; best = index; }
      });
      const column = best >= 0 ? columns[best] : undefined;
      if (!column || dist > Math.max(28, column.x1 - column.x0)) continue;
    }
    used.add(best);
    out[best] = cell.text.trim();
  }
  return out;
}

function asLines(rows: readonly Cell[][]): string[][] {
  return rows.map(row => [joinCellText(row)]).filter(row => row[0]);
}

export function trimBlankEdges(rows: string[][]): { rows: string[][]; kept: number[] } {
  const body = rows.filter(row => row.some(cell => cell.trim()));
  if (!body.length || !body[0]) return { rows: [], kept: [] };
  let start = 0;
  let end = body[0].length;
  while (start < end && body.every(row => !(row[start] ?? "").trim())) start++;
  while (end > start && body.every(row => !(row[end - 1] ?? "").trim())) end--;
  const kept: number[] = [];
  for (let index = start; index < end; index++) kept.push(index);
  return { rows: body.map(row => row.slice(start, end)), kept };
}

export interface LaidOut {
  rows: string[][];
  /** Left edge of each column, used to tell a continued table from a different one. Empty for a single column of lines. */
  anchors: number[];
}

/**
 * Line the rows up. Column breaks are the wide gaps, and a value lands in the column it overlaps, so a right-aligned
 * amount still sits under a shorter heading. One column of lines when nothing repeats across rows.
 */
export function layoutRows(rows: readonly Cell[][]): LaidOut {
  if (!rows.length) return { rows: [], anchors: [] };
  const gap = columnGap(rows);
  const logical = rows.map(row => splitByGap(row, gap).map(unionCell));
  const multi = logical.filter(row => row.length >= 2);
  // One selected row of a table still has columns. A wide gap in a longer paragraph does not: that needs a second row.
  if (multi.length === 1 && logical.length === 1) {
    return { rows: [multi[0].map(cell => cell.text.trim())], anchors: multi[0].map(cell => cell.x0) };
  }
  if (multi.length < 2) return { rows: asLines(rows), anchors: [] };
  const seed = multi.reduce((best, row) => row.length > best.length ? row : best);
  const columns = seed.map(cell => ({ x0: cell.x0, x1: cell.x1 }));
  const table = logical.map(row => assignColumns(row, columns));
  const trimmed = trimBlankEdges(table);
  const rich = trimmed.rows.filter(row => row.filter(cell => cell.trim()).length >= 2).length;
  if (trimmed.kept.length < 2 || rich < 2) return { rows: asLines(rows), anchors: [] };
  return { rows: trimmed.rows, anchors: trimmed.kept.map(index => columns[index].x0) };
}
