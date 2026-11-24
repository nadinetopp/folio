// Find tables in positioned text, using ruling lines when a page has them, and join a table that continues.
import { clusterRows, joinCellText, layoutRows, splitRowBlocks, trimBlankEdges } from "./items";
import { bandIndex, rulingGrids, type RulingGrid } from "./rulings";
import type { Box, Cell, CsvTable, Ruling } from "./types";

export interface PageTableSource {
  page: number;
  cells: Cell[];
  rulings: Ruling[];
}

interface Built {
  page: number;
  pageEnd: number;
  rows: string[][];
  anchors: number[];
  /** Top and bottom of the text, in PDF user space (y up). */
  top: number;
  bottom: number;
}

function rowKey(row: string[]): string {
  return row.map(cell => cell.trim()).join("\0");
}

/** The heading is the first row that fills the most columns (a title above it usually leaves the rest blank). */
function headerIndex(rows: string[][]): number {
  let best = 0;
  let count = -1;
  rows.forEach((row, index) => {
    const filled = row.filter(cell => cell.trim()).length;
    if (filled > count) { best = index; count = filled; }
  });
  return best;
}

function dropRepeatedHeader(previous: string[][], next: string[][]): string[][] {
  const header = previous[headerIndex(previous)];
  if (!header || !header.some(cell => cell.trim())) return next;
  const key = rowKey(header);
  const index = next.findIndex(row => rowKey(row) === key);
  if (index < 0) return next;
  return next.filter((_, rowIndex) => rowIndex !== index);
}

/** A continued page often repeats the lines above the new rows (a title, then the column headings). */
function dropRepeatedLead(previous: string[][], next: string[][]): string[][] {
  let index = 0;
  while (index < next.length && index < previous.length && next[index].some(cell => cell.trim()) && rowKey(next[index]) === rowKey(previous[index])) index++;
  return dropRepeatedHeader(previous, next.slice(index));
}

function columnsAlign(a: Built, b: Built): boolean {
  if (a.anchors.length < 2 || a.anchors.length !== b.anchors.length) return false;
  if ((a.rows[0]?.length ?? 0) !== (b.rows[0]?.length ?? 0)) return false;
  return a.anchors.every((x, index) => Math.abs(x - b.anchors[index]) <= 14);
}

function stitch(tables: Built[]): Built[] {
  const out: Built[] = [];
  for (const table of tables) {
    if (table.anchors.length >= 2) {
      let previous: Built | undefined;
      for (let index = out.length - 1; index >= 0; index--) {
        if (out[index].anchors.length >= 2) { previous = out[index]; break; }
      }
      // A note under the table is one column, so it does not block the grid that continues on the next page.
      if (previous && previous.pageEnd + 1 === table.page && columnsAlign(previous, table)) {
        previous.rows.push(...dropRepeatedLead(previous.rows, table.rows).filter(row => row.some(cell => cell.trim())));
        previous.pageEnd = table.page;
        continue;
      }
    }
    out.push({ ...table, rows: table.rows.map(row => [...row]), anchors: [...table.anchors] });
  }
  return out.filter(table => table.rows.some(row => row.some(cell => cell.trim())));
}

function fromGrid(cells: Cell[], grid: RulingGrid): { built: Built; used: Set<Cell> } | null {
  const bands: Cell[][][] = Array.from({ length: grid.ys.length - 1 }, () => grid.xs.slice(0, -1).map(() => [] as Cell[]));
  const used = new Set<Cell>();
  let top = -Infinity;
  for (const cell of cells) {
    const column = bandIndex(grid.xs, (cell.x0 + cell.x1) / 2);
    const row = bandIndex(grid.ys, (cell.y0 + cell.y1) / 2);
    if (column < 0 || row < 0) continue;
    bands[row][column].push(cell);
    used.add(cell);
    top = Math.max(top, cell.y1);
  }
  if (used.size < 2) return null;
  // ys run bottom to top; the last band is the first row on the page.
  const visual = [...bands].reverse().map(columns => columns.map(group => group.length ? joinCellText(group) : ""));
  const trimmed = trimBlankEdges(visual);
  if (trimmed.kept.length < 2 || trimmed.rows.length < 2) return null;
  const rich = trimmed.rows.filter(row => row.filter(cell => cell.trim()).length >= 2).length;
  if (rich < 1) return null;
  return {
    built: {
      page: cells.find(cell => used.has(cell))?.page ?? 1,
      pageEnd: cells.find(cell => used.has(cell))?.page ?? 1,
      rows: trimmed.rows,
      anchors: trimmed.kept.map(index => grid.xs[index]),
      top,
      bottom: Math.min(...[...used].map(cell => cell.y0)),
    },
    used,
  };
}

function fromFlow(cells: Cell[], page: number): Built[] {
  const blocks = splitRowBlocks(clusterRows(cells));
  const built: Built[] = [];
  for (const block of blocks) {
    const laid = layoutRows(block);
    if (!laid.rows.length) continue;
    const flat = block.flat();
    built.push({
      page, pageEnd: page, rows: laid.rows, anchors: laid.anchors,
      top: Math.max(...flat.map(cell => cell.y1)),
      bottom: Math.min(...flat.map(cell => cell.y0)),
    });
  }
  return built;
}

function tablesOnPage(source: PageTableSource): Built[] {
  const pool = source.cells.filter(cell => cell.text.trim());
  const claimed = new Set<Cell>();
  const built: Built[] = [];
  for (const grid of rulingGrids(source.rulings)) {
    const free = pool.filter(cell => !claimed.has(cell));
    const found = fromGrid(free, grid);
    if (!found) continue;
    for (const cell of found.used) claimed.add(cell);
    built.push({ ...found.built, page: source.page, pageEnd: source.page });
  }
  built.push(...fromFlow(pool.filter(cell => !claimed.has(cell)), source.page));
  return absorbHeadings(built);
}

/**
 * A title printed just above a grid is not inside the rules, so it would otherwise become its own one-column table.
 * Pull a short block that sits on top of a table into that table. A repeated title then drops with the repeated header.
 */
function absorbHeadings(parts: Built[]): Built[] {
  const sorted = [...parts].sort((a, b) => b.top - a.top);
  const out: Built[] = [];
  for (const part of sorted) {
    const above = out.at(-1);
    if (above && above.anchors.length < 2 && above.rows.length <= 4 && part.anchors.length >= 2) {
      const gap = above.bottom - part.top;
      if (gap < 56 && gap > -20) {
        const width = part.rows[0]?.length ?? 1;
        const heading = above.rows.map(row => {
          const text = row.map(cell => cell.trim()).filter(Boolean).join(" ");
          return [text, ...Array(Math.max(0, width - 1)).fill("")];
        }).filter(row => row[0]);
        part.rows = [...heading, ...part.rows];
        part.top = Math.max(part.top, above.top);
        part.bottom = Math.min(part.bottom, above.bottom);
        out[out.length - 1] = part;
        continue;
      }
    }
    out.push(part);
  }
  return out;
}

/** Tables in reading order. A grid that continues on the next page is one table, with a repeated heading removed. */
export function tablesFromPages(pages: readonly PageTableSource[]): CsvTable[] {
  const built = pages.flatMap(tablesOnPage);
  return stitch(built).map(table => ({ page: table.page, pageEnd: table.pageEnd, rows: table.rows }));
}

function centerIn(cell: Cell, rects: readonly Box[]): boolean {
  const x = (cell.x0 + cell.x1) / 2;
  const y = (cell.y0 + cell.y1) / 2;
  return rects.some(([x0, y0, x1, y1]) => x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && y >= Math.min(y0, y1) && y <= Math.max(y0, y1));
}

/** Text inside the selection, and the rules that still border it (they sit just outside the glyphs). */
export function clipToRegion(cells: readonly Cell[], rulings: readonly Ruling[], rects: readonly Box[]): { cells: Cell[]; rulings: Ruling[] } {
  const kept = cells.filter(cell => centerIn(cell, rects));
  if (!kept.length) return { cells: [], rulings: [] };
  const x0 = Math.min(...kept.map(cell => cell.x0)) - 12;
  const y0 = Math.min(...kept.map(cell => cell.y0)) - 12;
  const x1 = Math.max(...kept.map(cell => cell.x1)) + 12;
  const y1 = Math.max(...kept.map(cell => cell.y1)) + 12;
  const lines = rulings.filter(ruling => ruling.axis === "v"
    ? ruling.at >= x0 && ruling.at <= x1 && ruling.to >= y0 && ruling.from <= y1
    : ruling.at >= y0 && ruling.at <= y1 && ruling.to >= x0 && ruling.from <= x1);
  return { cells: kept, rulings: lines };
}
