import { DocumentTypeTable } from "./DocumentTypeTable.jsx";

/* Same table shape as Purchase Orders, filtered to invoices — opens the
   ordinary review popup, since an invoice's own review/approve workflow is
   the point of clicking one, not a comparison. */
export function InvoicesSection({ docs, sites, onOpenDocument }) {
  return (
    <DocumentTypeTable
      docs={docs}
      sites={sites}
      type="INVOICE"
      numberLabel="Invoice No."
      emptyText="No invoices yet — scan or upload one to get started."
      onOpenRow={(d) => onOpenDocument(d.document_id)}
    />
  );
}
