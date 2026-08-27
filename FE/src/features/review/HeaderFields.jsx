import { HEADER_SECTIONS } from "./schema.js";
import { inr } from "../../lib/format.js";

/* Read-only once a document is approved or rejected: the decision is a record,
   so the numbers behind it stop being editable.

   sections defaults to the document schema — quote review passes
   QUOTE_HEADER_SECTIONS instead, so the same grouped layout and locked/
   editable Editor logic serve both without a second copy of either.

   fieldErrors is {field_key: message} — ReviewModal's completeness gates
   (missing PO number, missing invoice channel, unset/OTHER document type),
   shown right above the field they're actually about instead of bundled
   into one banner wherever the Decision section happens to sit. */
export function HeaderFields({ header, locked, onChange, sections = HEADER_SECTIONS, fieldErrors = {} }) {
  return (
    <>
      {sections.map((section) => {
        const visibleFields = section.fields.filter((field) => !field.showIf || field.showIf(header ?? {}));
        // A field-grid row holds several labels side by side — if only one
        // of them happens to have an error, that field alone growing taller
        // pushes its own input down out of line with its row-mates. Once
        // any field in this section has something to say, every field in it
        // reserves the same slot (blank or not) so the row stays level; a
        // section with nothing to report skips the slot entirely rather
        // than leaving permanent dead space above fields that never error.
        const reserveSlot = visibleFields.some((field) => fieldErrors[field.key]);
        return (
          <div className="field-section" key={section.title}>
            <h3>{section.title}</h3>
            <div className="field-grid">
              {visibleFields.map((field) => (
                <label key={field.key}>
                  {reserveSlot ? (
                    <div className="field-error">{fieldErrors[field.key] || " "}</div>
                  ) : null}
                  <span>{field.label}</span>
                  {locked
                    ? <div className="display">{display(header, field)}</div>
                    : <Editor field={field} header={header} onChange={onChange} />}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

const display = (header, field) => {
  const value = header?.[field.key];
  if (field.type === "number") return inr(value);
  return value || "—";
};

function Editor({ field, header, onChange }) {
  const raw = header?.[field.key] ?? "";
  // UNCLASSIFIED is the server's "nobody has picked one yet" value, not an
  // option on the list — show the same blank placeholder an unset field gets.
  const value = field.key === "doc_kind" && raw === "UNCLASSIFIED" ? "" : raw;

  if (field.type === "select") {
    return (
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
      >
        <option value="">—</option>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  return (
    <input
      className="input"
      type={field.type === "number" ? "number" : "text"}
      step="any"
      value={value}
      onChange={(e) => onChange(field.key, e.target.value)}
    />
  );
}
