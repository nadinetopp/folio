import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { openPdf } from "../../testing/pdfjs";
import { exportPdfToCsv } from "./exportDocument";

async function samplePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const drawGrid = (page: ReturnType<PDFDocument["addPage"]>, rows: string[][], yTop: number) => {
    const xs = [72, 220, 320, 460];
    const rowH = 28;
    for (let r = 0; r <= rows.length; r++) {
      const y = yTop - r * rowH;
      page.drawLine({ start: { x: xs[0], y }, end: { x: xs[3], y }, thickness: 0.7, color: rgb(0, 0, 0) });
    }
    for (const x of xs) page.drawLine({ start: { x, y: yTop }, end: { x, y: yTop - rows.length * rowH }, thickness: 0.7, color: rgb(0, 0, 0) });
    rows.forEach((row, r) => {
      row.forEach((text, c) => {
        if (!text) return;
        page.drawText(text, { x: xs[c] + 4, y: yTop - (r + 1) * rowH + 8, size: 11, font });
      });
    });
  };

  const ledger = doc.addPage([612, 792]);
  // Two lines in the first data cell, still inside one ruled row.
  drawGrid(ledger, [
    ["Description", "Qty", "Amount"],
    ["", "1", "$1,200.00"],
    ["Tax", "", "$10.00"],
  ], 700);
  ledger.drawText("North", { x: 76, y: 700 - 2 * 28 + 16, size: 11, font });
  ledger.drawText("lot", { x: 76, y: 700 - 2 * 28 + 4, size: 11, font });

  const more = doc.addPage([612, 792]);
  drawGrid(more, [
    ["Description", "Qty", "Amount"],
    ["Fee", "2", "$5.00"],
  ], 700);

  const invoice = doc.addPage([612, 792]);
  invoice.drawText("Invoice 1042", { x: 72, y: 720, size: 12, font });
  const cols = [72, 300, 380, 470];
  const body = [
    ["Description", "Qty", "Rate", "Amount"],
    ["Monthly rent", "1", "$1,500.00", "$1,500.00"],
    ["Late fee", "1", "$75.00", "$75.00"],
  ];
  body.forEach((row, r) => {
    row.forEach((text, c) => invoice.drawText(text, { x: cols[c], y: 690 - r * 18, size: 11, font }));
  });

  doc.addPage([612, 792]);
  return doc.save();
}

describe("exportPdfToCsv", () => {
  it("exports a bordered ledger, stitches the next page, and keeps a borderless invoice", async () => {
    const pdf = await openPdf(await samplePdf());
    const result = await exportPdfToCsv(pdf, { pages: [1, 2, 3, 4], bom: true });
    expect(result.blankPages).toEqual([4]);
    expect(result.csv.startsWith("\uFEFF")).toBe(true);
    const text = result.csv.slice(1);
    expect(text).toContain('North\nlot');
    expect(text).toContain('"$1,200.00"');
    expect(text).toContain("Tax,,$10.00");
    expect(text).toContain("Fee,2,$5.00");
    expect(text.match(/Description,Qty,Amount/g)).toHaveLength(1);
    expect(text).toContain("Table 2 (page 3)");
    expect(text).toContain("Invoice 1042");
    expect(text).toContain('Monthly rent,1,"$1,500.00","$1,500.00"');
    expect(text).toContain("Late fee,1,$75.00,$75.00");
    expect(text.endsWith("\r\n")).toBe(true);
    // The currency strings are copied, not recalculated.
    expect(text).not.toContain("1200");
    expect(text).not.toContain("1500");
  });
});
