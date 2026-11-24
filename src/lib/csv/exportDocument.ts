// Read tables out of a PDF already open in Folio. This does not recognize scans; the caller says so when a page is blank.
import type { PDFDocumentProxy } from "../../pdf";
import { clipToRegion, tablesFromPages, type PageTableSource } from "./detect";
import { cellsFromItems } from "./items";
import { extractRulings } from "./rulings";
import type { Box, CsvTable } from "./types";
import { toCsv } from "./write";

export interface CsvExportOptions {
  /** 1-based pages, in the order they should be read. */
  pages: number[];
  /** When set, only the text inside these PDF-space rectangles (on `page`) is exported. */
  region?: { page: number; rects: Box[] };
  /** Prefix a UTF-8 BOM so Excel treats the file as Unicode. */
  bom: boolean;
}

export interface CsvExportResult {
  csv: string;
  tables: CsvTable[];
  /** Pages in the request that had no text. */
  blankPages: number[];
}

interface PageProxy {
  getTextContent(): Promise<{ items: unknown[] }>;
  getOperatorList(params?: { annotationMode?: number }): Promise<{ fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }>;
}

async function readPage(pdf: PDFDocumentProxy, pageNumber: number): Promise<PageTableSource & { textRuns: number }> {
  const page = await pdf.getPage(pageNumber) as PageProxy;
  const text = await page.getTextContent();
  const cells = cellsFromItems(text.items, pageNumber);
  // annotationMode 0 is pdf.js DISABLE: highlights and ink are not table rules.
  let rulings = [] as PageTableSource["rulings"];
  try {
    const operators = await page.getOperatorList({ annotationMode: 0 });
    rulings = extractRulings(operators.fnArray, operators.argsArray);
  } catch {
    // A page with broken drawing operators still exports from its text.
    rulings = [];
  }
  return { page: pageNumber, cells, rulings, textRuns: cells.length };
}

/** Build a CSV for the requested pages. An empty string means none of them had text. */
export async function exportPdfToCsv(pdf: PDFDocumentProxy, options: CsvExportOptions): Promise<CsvExportResult> {
  const pages = [...new Set(options.pages.filter(page => page >= 1 && page <= pdf.numPages))].sort((a, b) => a - b);
  const blankPages: number[] = [];
  const sources: PageTableSource[] = [];
  for (const pageNumber of pages) {
    const source = await readPage(pdf, pageNumber);
    if (!source.textRuns) { blankPages.push(pageNumber); continue; }
    if (options.region && options.region.page === pageNumber) {
      const clipped = clipToRegion(source.cells, source.rulings, options.region.rects);
      if (!clipped.cells.length) { blankPages.push(pageNumber); continue; }
      sources.push({ page: pageNumber, cells: clipped.cells, rulings: clipped.rulings });
    } else sources.push(source);
  }
  const tables = tablesFromPages(sources);
  return { csv: toCsv(tables, options.bom), tables, blankPages };
}
