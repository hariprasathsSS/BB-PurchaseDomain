import { HEADER_SECTIONS } from "./schema.js";
import { Combobox } from "../../components/Combobox.jsx";
import { docTypeLabel, inr } from "../../lib/format.js";

/* Read-only once a document is approved or rejected: the decision is a record,
   so the numbers behind it stop being editable.

   sections defaults to the document schema — quote review passes
   QUOTE_HEADER_SECTIONS instead, so the same grouped layout and locked/
   editable Editor logic serve both without a second copy of either.

   fieldErrors is {field_key: message} — ReviewModal's completeness gates
   (missing PO number, missing invoice channel, unset/OTHER document type),
   shown right under the field they're actually about instead of bundled
   into one banner wherever the Decision section happens to sit.

   fieldOptions is {field_key: string[]} — known values worth suggesting for
   a text field (e.g. po_number: every PO already on file in this same
   project). Rendered as a Combobox, so typing a value that isn't in the
   list still works exactly like a plain text field — this only adds a
   dropdown of what's already there, it never restricts the field to it. */
export function HeaderFields({
  header, locked, onChange, sections = HEADER_SECTIONS, fieldErrors = {}, fieldOptions = {},
}) {
  return (
    <>
      {sections.map((section) => {
        const visibleFields = section.fields.filter((field) => !field.showIf || field.showIf(header ?? {}));
        // A field-grid row holds several labels side by side — if only one
        // of them has an error sitting under its input, that field alone
        // grows taller than its row-mates. Once any field in this section
        // has something to say, every field in it reserves the same slot
        // (blank or not) below its input so the row stays level; a section
        // with nothing to report skips the slot entirely rather than
        // leaving permanent dead space under fields that never error.
        const reserveSlot = visibleFields.some((field) => fieldErrors[field.key]);
        return (
          <div className="field-section" key={section.title}>
            <h3>{section.title}</h3>
            <div className="field-grid">
              {visibleFields.map((field) => (
                // is-invalid marks the field itself, so the input carries the
                // problem visually and the sentence under it only has to say
                // what the problem is — see .field-grid label.is-invalid.
                <label key={field.key} className={fieldErrors[field.key] ? "is-invalid" : undefined}>
                  <span>{typeof field.label === "function" ? field.label(header ?? {}) : field.label}</span>
                  {locked
                    ? <div className="display">{display(header, field)}</div>
                    : (
                      <Editor
                        field={field}
                        header={header}
                        onChange={onChange}
                        options={fieldOptions[field.key]}
                      />
                    )}
                  {reserveSlot ? (
                    <div className="field-error">{fieldErrors[field.key] || " "}</div>
                  ) : null}
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
  if (field.type === "select") return value ? docTypeLabel(value) : "—";
  return value || "—";
};

function Editor({ field, header, onChange, options }) {
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
        {field.options.map((o) => <option key={o} value={o}>{docTypeLabel(o)}</option>)}
      </select>
    );
  }

  if (options?.length) {
    return (
      <Combobox
        value={value}
        onChange={(v) => onChange(field.key, v)}
        options={options}
      />
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
