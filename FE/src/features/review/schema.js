/* The reviewer's form, grouped the way a person reads a document rather than
   the way the table is laid out. Mirrors the extraction schema in
   Backend/extract.py — a field added there needs a row here to be correctable. */

export const HEADER_SECTIONS = [
  {
    title: "Classification",
    fields: [
      { key: "doc_kind", label: "Document type", type: "select",
        options: ["UNCLASSIFIED", "INVOICE", "PO", "DELIVERY", "OTHER"] },
    ],
  },
  {
    title: "Document numbers",
    fields: [
      { key: "doc_number", label: "Document no." },
      { key: "po_number", label: "PO no." },
      { key: "dc_number", label: "DC no." },
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
  { key: "unit", label: "Unit" },
  { key: "rate", label: "Rate", type: "number" },
  { key: "amount", label: "Amount", type: "number" },
  { key: "tax_rate", label: "Tax %", type: "number" },
];

export const HEADER_KEYS = HEADER_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));
