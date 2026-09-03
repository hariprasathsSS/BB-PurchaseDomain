import { createPortal } from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { inr, money } from "../../lib/format.js";
import { amountInWords } from "../../lib/numberToWords.js";

/* The client's own "PURCHASE BILL VOUCHER" paper form — same letterhead,
   same two-column reference box, same item table and totals block as the
   physical voucher this replaces. Shared by both renderings below: the
   hidden print-only one (PurchaseBillVoucher) and the visible on-screen one
   (PurchaseBillPreview) — a generated Purchase Bill has no scanned page to
   show in the review screen's usual thumbnail slot, so this fills it with
   the same layout the print button produces. */
function VoucherBody({ header, lines, materials, project }) {
  const materialFor = (line) => materials?.find((m) => m.id === line.material_id);

  const other = (Number(header.tcs_amount) || 0) + (Number(header.rounding_off) || 0);
  const taxRows =
    header.tax_type === "CGST_SGST"
      ? [
          ["CGST", header.cgst_amount, header.basic_value],
          ["SGST", header.sgst_amount, header.basic_value],
        ]
      : [["IGST", header.igst_amount, header.basic_value]];

  return (
    <>
      <h1>PURCHASE BILL VOUCHER</h1>
      <div className="pb-voucher-org">B AND B DEVELOPERS AND BUILDERS PRIVATE LIMITED</div>
      <div className="pb-voucher-addr">No. 2, 13th East Cross Road, Gandhi Nagar, Vellore-632006</div>
      <div className="pb-voucher-addr">Tamil Nadu</div>
      <div className="pb-voucher-gst">GST No :33AADCB4217G1Z6</div>

      <table className="pb-voucher-info">
        <tbody>
          <tr>
            <td className="pb-voucher-label">Project</td>
            <td>: {header.delivery_address_raw || project?.name || "—"}</td>
            <td className="pb-voucher-label">PO NO</td>
            <td>: {header.po_number || "—"}</td>
          </tr>
          <tr>
            <td className="pb-voucher-label">Vendor Name</td>
            <td>: {header.vendor_name_raw || "—"}</td>
            <td className="pb-voucher-label">MIN NO</td>
            <td>: {header.min_number || "—"}</td>
          </tr>
          <tr>
            <td className="pb-voucher-label">Vendor GST</td>
            <td>: {header.vendor_gstin || "—"}</td>
            <td className="pb-voucher-label">Bill Date</td>
            <td>: {header.doc_date_raw || "—"}</td>
          </tr>
          <tr>
            <td className="pb-voucher-label">PV No</td>
            <td>: {header.doc_number || "—"}</td>
            <td className="pb-voucher-label">Invoice No</td>
            <td>: {header.dc_number || "—"}</td>
          </tr>
          <tr>
            <td className="pb-voucher-label">PV Date</td>
            <td>: {header.doc_date_raw || "—"}</td>
            <td />
            <td />
          </tr>
        </tbody>
      </table>

      <table className="pb-voucher-lines">
        <thead>
          <tr>
            <th>S No.</th>
            <th>Code</th>
            <th>Resource</th>
            <th>Resource Group</th>
            <th>Unit</th>
            <th>Qty</th>
            <th>Rate</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {(lines ?? []).map((l, i) => {
            const m = materialFor(l);
            return (
              <tr key={l.line_no ?? i}>
                <td>{i + 1}</td>
                <td>{m?.code || "—"}</td>
                <td>{m?.name || l.description_raw}</td>
                <td>{m?.category || "—"}</td>
                <td>{l.unit || "—"}</td>
                <td>{l.quantity ?? "—"}</td>
                <td>{l.rate != null ? inr(l.rate) : "—"}</td>
                <td>{l.amount != null ? inr(l.amount) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <table className="pb-voucher-totals">
        <tbody>
          <tr><td>Total</td><td>{header.basic_value != null ? inr(header.basic_value) : "—"}</td></tr>
          {taxRows.map(([label, amount, base]) =>
            amount != null ? (
              <tr key={label}>
                <td>
                  {label}
                  {base ? `:${((Number(amount) / Number(base)) * 100).toFixed(3)}%(+)` : ""}
                </td>
                <td>{inr(amount)}</td>
              </tr>
            ) : null
          )}
          <tr><td>Other Amount</td><td>{inr(other)}</td></tr>
          <tr className="pb-voucher-net"><td>Net Amount</td><td>{money(header.total_value) ?? "—"}</td></tr>
        </tbody>
      </table>

      <div className="pb-voucher-words">
        Amount In words : {header.total_value != null ? amountInWords(header.total_value) : "—"}
      </div>
      <div className="pb-voucher-narration">Narration:</div>
    </>
  );
}

/* Hidden on screen (see .pb-voucher in app.css); the browser's print dialog
   is what a reviewer actually sees it through, via the Print button in
   ReviewModal.

   Portalled straight onto <body> rather than rendered inline: the modal
   backdrop it would otherwise sit inside is unconditionally display:none in
   print (see app.css's existing print rules, written for the plain pages
   behind a modal, not the modal itself) — CSS can't selectively un-hide a
   descendant of a display:none ancestor, so this escapes that ancestor
   instead. Its own print CSS then hides #root only while this exists in the
   DOM (:has(.pb-voucher)), leaving every other print path — the Document
   Register, a project's own Print button — untouched. */
export function PurchaseBillVoucher({ header, lines, materials, project }) {
  if (!header) return null;
  return createPortal(
    <div className="pb-voucher">
      <VoucherBody header={header} lines={lines} materials={materials} project={project} />
    </div>,
    document.body
  );
}

/* The visible counterpart — rendered inline, in the review screen's own
   page slot, for a document that has no scanned image to show there at
   all (a generated Purchase Bill never had a paper page to photograph).
   Same layout as the print version, just not hidden and not portalled. */
export function PurchaseBillPreview({ header, lines, materials, project }) {
  if (!header) return null;
  return (
    <div className="pb-voucher-preview">
      <VoucherBody header={header} lines={lines} materials={materials} project={project} />
    </div>
  );
}

/* Just the .pb-voucher* rules from app.css, duplicated here — the tab this
   opens is a bare document with no app bundle behind it (no Vite dev-server
   module graph to <link> the real stylesheet from), so it carries its own
   copy of only what it actually uses. Keep in sync with app.css if the
   voucher's own look changes there. */
const VOUCHER_CSS = `
  body { margin: 24px; font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; }
  h1 { text-align: center; font-size: 20px; letter-spacing: .04em; margin: 0 0 10px; }
  .pb-voucher-org { text-align: center; font-weight: 700; font-size: 14px; }
  .pb-voucher-addr { text-align: center; font-size: 12.5px; }
  .pb-voucher-gst { text-align: center; font-weight: 700; font-size: 12.5px; margin-bottom: 14px; }
  .pb-voucher-info { width: 100%; border: 1px solid #000; border-collapse: collapse; font-size: 12.5px; margin-bottom: 14px; }
  .pb-voucher-info td { padding: 5px 8px; border: none; }
  .pb-voucher-info tr:not(:last-child) td { border-bottom: 1px solid #ddd; }
  .pb-voucher-info .pb-voucher-label { font-weight: 700; width: 14%; white-space: nowrap; }
  .pb-voucher-info td:nth-child(2) { width: 36%; }
  .pb-voucher-lines { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 4px; }
  .pb-voucher-lines th, .pb-voucher-lines td { border: 1px solid #000; padding: 6px 8px; text-align: left; }
  .pb-voucher-lines th { font-weight: 700; background: #f2f2f2; }
  .pb-voucher-totals { width: 260px; margin-left: auto; border-collapse: collapse; font-size: 12.5px; }
  .pb-voucher-totals td { border: 1px solid #000; padding: 5px 10px; }
  .pb-voucher-totals td:first-child { font-weight: 700; }
  .pb-voucher-totals td:last-child { text-align: right; }
  .pb-voucher-net td { font-weight: 700; }
  .pb-voucher-words { margin-top: 16px; font-size: 12.5px; font-weight: 700; }
  .pb-voucher-narration { margin-top: 20px; font-size: 12.5px; font-weight: 700; }
`;

/* The thumbnail's own click target — a real, separate browser tab showing
   the voucher, same as clicking any scanned document's own page thumbnail
   opens its image in one. Print stays its own deliberate action (the
   "Print Purchase Bill" button, still wired to window.print()); this is
   just for looking at it. Built by hand rather than reusing the hidden
   PurchaseBillVoucher/print path: that path targets *this* window's own
   print dialog via CSS, not a new tab of its own. */
export function openPurchaseBillTab({ header, lines, materials, project }) {
  if (!header) return;
  const body = renderToStaticMarkup(
    <VoucherBody header={header} lines={lines} materials={materials} project={project} />
  );
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(
    `<!doctype html><html><head><meta charset="utf-8">` +
      `<title>${header.doc_number || "Purchase Bill"}</title>` +
      `<style>${VOUCHER_CSS}</style></head><body>${body}</body></html>`
  );
  win.document.close();
}
