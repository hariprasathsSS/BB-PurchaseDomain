import { HEADER_SECTIONS } from "./schema.js";
import { inr } from "../../lib/format.js";

/* Read-only once a document is approved or rejected: the decision is a record,
   so the numbers behind it stop being editable. */
export function HeaderFields({ header, locked, onChange }) {
  return (
    <>
      {HEADER_SECTIONS.map((section) => (
        <div className="field-section" key={section.title}>
          <h3>{section.title}</h3>
          <div className="field-grid">
            {section.fields.map((field) => (
              <label key={field.key}>
                <span>{field.label}</span>
                {locked
                  ? <div className="display">{display(header, field)}</div>
                  : <Editor field={field} header={header} onChange={onChange} />}
              </label>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

const display = (header, field) => {
  const value = header?.[field.key];
  if (field.type === "number") return inr(value);
  return value || "—";
};

function Editor({ field, header, onChange }) {
  const value = header?.[field.key] ?? "";

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
