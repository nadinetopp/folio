// RFC 4180 CSV. Fields stay as written: a thousands separator is not parsed, only quoted.
import type { CsvTable } from "./types";

/** Quote a field that contains a comma, quote, or line break, and double any quote inside it. */
export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function label(table: CsvTable, index: number): string {
  const where = table.pageEnd > table.page ? `pages ${table.page}-${table.pageEnd}` : `page ${table.page}`;
  return `Table ${index + 1} (${where})`;
}

/**
 * One table is written on its own, so the first row can be the heading Excel expects.
 * Further tables are separated by a blank line and a label row.
 */
export function toCsv(tables: readonly CsvTable[], bom: boolean): string {
  const useful = tables.filter(table => table.rows.some(row => row.some(cell => cell.trim())));
  if (!useful.length) return "";
  const lines: string[] = [];
  useful.forEach((table, index) => {
    if (useful.length > 1 && index > 0) {
      lines.push("");
      lines.push(escapeCsvField(label(table, index)));
    }
    for (const row of table.rows) lines.push(row.map(cell => escapeCsvField(cell)).join(","));
  });
  return (bom ? "\uFEFF" : "") + lines.join("\r\n") + "\r\n";
}
