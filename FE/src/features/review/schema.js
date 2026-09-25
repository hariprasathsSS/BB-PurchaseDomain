/* The reviewer's form, grouped the way a person reads a document rather than
   the way the table is laid out. Mirrors the extraction schema in
   Backend/extract.py — a field added there needs a row here to be correctable. */

export const HEADER_SECTIONS = [
  {
    title: "Classification",
    fields: [
      /* UNCLASSIFIED is not a pickable option — it's the absence of one. The
         blank placeholder in Editor already covers it; see ReviewModal's
         Approve gate, which reads the same absence. */
      { key: "doc_kind", label: "Document type", type: "select",
        options: ["INVOICE", "PO", "DELIVERY", "QUOTATION", "INWARD", "PURCHASE_BILL", "OTHER"] },
    ],
  },
  {
    title: "Document numbers",
    fields: [
      { key: "doc_number", label: "Document no." },
      { key: "po_number", label: "PO no." },
      // A real delivery challan's own number on an INVOICE, but reused for
      // "the invoice this references" on an INWARD (MIN Voucher) or
      // PURCHASE_BILL page — see doc_headers.dc_number in db.py. Same field
      // either way, so it's always shown, not gated behind a showIf — only
      // the label changes, so a reviewer looking at an invoice never reads
      // this as "where did my own invoice number go" (see ReviewModal's
      // dcNumberOptions for the matching dropdown-on-INWARD/PURCHASE_BILL
      // behaviour this label change goes with).
      {
        key: "dc_number",
        label: (h) => (["INWARD", "PURCHASE_BILL"].includes(h.doc_kind) ? "Invoice no. (referenced)" : "DC no."),
      },
      // Which MIN Voucher a Purchase Bill was closed out from — meaningless
      // for every other document type, so it only shows up once doc_kind
      // is PURCHASE_BILL.
      { key: "min_number", label: "MIN no.", showIf: (h) => h.doc_kind === "PURCHASE_BILL" },
    ],
  },
  {
    title: "Dates",
    fields: [{ key: "doc_date_raw", label: "Document date (as printed)" }],
  },
  {
    title: "Vendor",
    fields: [
      { key: "vendor_name_raw", label: "Vendor name" },
      { key: "vendor_gstin", label: "Vendor GSTIN" },
      { key: "buyer_gstin", label: "Buyer GSTIN" },
    ],
  },
  {
    title: "Delivery",
    fields: [
      { key: "place_of_supply", label: "Place of supply" },
      { key: "delivery_address_raw", label: "Delivery address" },
      {
        key: "vehicle_number",
        label: "Vehicle no.",
        showIf: (h) => ["INVOICE", "INWARD"].includes(h.doc_kind),
      },
    ],
  },
  {
    title: "Tax and amounts",
    fields: [
      { key: "basic_value", label: "Basic value", type: "number" },
      { key: "tax_type", label: "Tax type", type: "select", options: ["IGST", "CGST_SGST"] },
      { key: "igst_amount", label: "IGST", type: "number" },
      { key: "cgst_amount", label: "CGST", type: "number" },
      { key: "sgst_amount", label: "SGST", type: "number" },
      { key: "tcs_amount", label: "TCS", type: "number" },
      { key: "rounding_off", label: "Rounding off", type: "number" },
      { key: "total_value", label: "Total value", type: "number" },
    ],
  },
  { title: "Other", fields: [{ key: "irn", label: "IRN" }] },
];

export const LINE_FIELDS = [
  { key: "description_raw", label: "Description" },
  { key: "material_id", label: "Material", type: "material" },
  { key: "hsn_code", label: "HSN" },
  { key: "quantity", label: "Qty", type: "number" },
  // A MIN Voucher's own split of "Qty" above — what was actually taken in
  // vs. refused. Meaningless on every other document type (an invoice or
  // PO line has no receiving outcome yet), so these only show up once
  // doc_kind is INWARD — same showIf pattern min_number's header field uses.
  { key: "accept_qty", label: "Accepted", type: "number", showIf: (h) => h.doc_kind === "INWARD" },
  { key: "reject_qty", label: "Rejected", type: "number", showIf: (h) => h.doc_kind === "INWARD" },
  { key: "unit", label: "Unit" },
  { key: "rate", label: "Rate", type: "number" },
  { key: "amount", label: "Amount", type: "number" },
  { key: "tax_rate", label: "Tax %", type: "number" },
];

export const HEADER_KEYS = HEADER_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

/* Quote review's own small schema — a quotation has no doc_kind, tax breakup
   or dc_* fields, and a grade/brand column the document schema has no use
   for. One section, since there are only four header fields — HeaderFields
   still expects a list of sections, just a list of one. */
export const QUOTE_HEADER_SECTIONS = [
  {
    title: "Quotation",
    fields: [
      { key: "vendor_name_raw", label: "Vendor name" },
      { key: "vendor_gstin", label: "Vendor GSTIN" },
      { key: "quote_number", label: "Quote no." },
      { key: "quote_date_raw", label: "Quote date (as printed)" },
    ],
  },
];

export const QUOTE_HEADER_FIELDS = QUOTE_HEADER_SECTIONS.flatMap((s) => s.fields);

export const QUOTE_LINE_FIELDS = [
  { key: "description_raw", label: "Description" },
  { key: "material_id", label: "Material", type: "material" },
  { key: "grade_raw", label: "Grade / brand" },
  { key: "quantity", label: "Qty", type: "number" },
  { key: "unit", label: "Unit" },
  { key: "rate", label: "Rate", type: "number" },
  { key: "amount", label: "Amount", type: "number" },
];
