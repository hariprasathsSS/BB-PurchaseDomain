import { DocumentTypeTable } from "./DocumentTypeTable.jsx";
import { go } from "../../lib/useHashRoute.js";

/* A purchase order is just a document the classifier read as PO — this is a
   dedicated view onto that subset. Opening one goes to the Compare page
   (PO next to whatever invoices already reference it), not the plain
   review popup — that's the point of scanning a PO in the first place. */
export function PurchaseOrdersSection({ docs, sites }) {
  return (
    <DocumentTypeTable
      docs={docs}
      sites={sites}
      type="PO"
      numberLabel="PO No."
      emptyText="No purchase orders yet — scan or upload a PO to get started."
      onOpenRow={(d) => go(`/compare/${d.document_id}`)}
    />
  );
}
