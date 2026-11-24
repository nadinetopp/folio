// Shapes shared by CSV export. Coordinates are PDF user space: x grows right, y grows up.
import type { Box } from "../ocr/types";

export type { Box };

/** One visible text run. Whitespace-only runs are dropped before a Cell is built. */
export interface Cell {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  page: number;
}

/** An axis-aligned rule. `at` is y for a horizontal line and x for a vertical one. */
export interface Ruling {
  axis: "h" | "v";
  at: number;
  from: number;
  to: number;
}

/** A finished grid, top row first. `page` is where it starts; `pageEnd` differs after a continuation is joined on. */
export interface CsvTable {
  page: number;
  pageEnd: number;
  rows: string[][];
}
