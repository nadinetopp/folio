import { useState } from "react";
import { Modal } from "./Dialogs";

/** Pages to export, and whether the file should carry the mark Excel uses to detect UTF-8. */
export function CsvExportDialog({
  busy, onClose, onExport,
}: {
  busy: boolean;
  onClose: () => void;
  onExport: (scope: "page" | "all", bom: boolean) => void;
}) {
  const [scope, setScope] = useState<"page" | "all">("page");
  const [bom, setBom] = useState(true);
  return (
    <Modal title="Export as CSV" onClose={onClose}>
      <form className="csv-export" onSubmit={event => { event.preventDefault(); if (!busy) onExport(scope, bom); }}>
        <p>Rows and columns follow the text on the page. Numbers and currency stay as written.</p>
        <fieldset>
          <legend>Pages</legend>
          <label><input type="radio" name="csv-scope" checked={scope === "page"} onChange={() => setScope("page")} />This page</label>
          <label><input type="radio" name="csv-scope" checked={scope === "all"} onChange={() => setScope("all")} />All pages</label>
        </fieldset>
        <label className="csv-bom"><input type="checkbox" checked={bom} onChange={event => setBom(event.target.checked)} />Excel-friendly (UTF-8 BOM)</label>
        <p className="search-hint">A scanned page has no text until you choose Recognize text.</p>
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? "Exporting…" : "Export"}</button>
        </div>
      </form>
    </Modal>
  );
}
