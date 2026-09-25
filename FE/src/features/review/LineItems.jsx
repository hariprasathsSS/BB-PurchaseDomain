import { LINE_FIELDS } from "./schema.js";
import { inr } from "../../lib/format.js";

/* The extracted line items. The material column is the important one: a bad
   automatic match is corrected here, which is what teaches the alias table.

   fields defaults to the document schema (LINE_FIELDS) — quote review passes
   QUOTE_LINE_FIELDS instead, so the same table, material picker and locked/
   editable Cell logic serve both without a second copy of any of it.

   header is only there for a field's own showIf(header) — same mechanism
   HeaderFields uses, e.g. accept_qty/reject_qty only being columns at all
   once doc_kind is INWARD. Optional: callers with no per-document schema
   concept (quote review) just don't pass it, and nothing here has a showIf
   that needs it. */
/* lineIssues is {material_id: [message]} — what another document in this
   one's own delivery says about that material (see main.py's line-issues).
   Shown as a marker on the line it concerns rather than as prose in a panel
   somewhere else, so "the MIN Voucher recorded less of this" is answered
   where the question gets asked. */
export function LineItems({
  lines, materials, locked, onChange, fields = LINE_FIELDS, header, lineIssues = {},
}) {
  const visibleFields = fields.filter((f) => !f.showIf || f.showIf(header ?? {}));

  if (!lines.length) {
    return (
      <div className="field-section">
        <h3>Line items</h3>
        <div className="empty">No line items.</div>
      </div>
    );
  }

  return (
    <div className="field-section">
      <h3>Line items</h3>
      <div className="table-wrap">
        <table className="data lines">
          <thead>
            <tr>
              <th>#</th>
              {visibleFields.map((f) => <th key={f.key}>{f.label}</th>)}
              {/* The issue marker's own column, last — unlabelled, since a
                  row either has something to say or the cell stays empty. */}
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const issues = lineIssues[line.material_id] ?? [];
              return (
                <tr key={line.line_no}>
                  <td className="num">{line.line_no}</td>
                  {visibleFields.map((field) => (
                    <td key={field.key}>
                      <Cell
                        field={field}
                        line={line}
                        materials={materials}
                        locked={locked}
                        onChange={onChange}
                      />
                    </td>
                  ))}
                  <td className="line-issue-cell">
                    {issues.length ? (
                      <span
                        className="line-issue"
                        title={issues.join("\n")}
                        role="img"
                        aria-label={issues.join(" ")}
                      >
                        i
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ field, line, materials, locked, onChange }) {
  const value = line[field.key] ?? "";

  if (field.type === "material") {
    if (locked) {
      return (
        <span className="mono">
          {materials.find((m) => m.id === value)?.name ?? "— unmatched —"}
        </span>
      );
    }
    return (
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(line.line_no, field.key, e.target.value)}
      >
        <option value="">— unmatched —</option>
        {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    );
  }

  if (locked) {
    return (
      <span className="mono">
        {field.type === "number" ? inr(line[field.key]) : (line[field.key] ?? "—")}
      </span>
    );
  }

  return (
    <input
      className="input"
      type={field.type === "number" ? "number" : "text"}
      step="any"
      value={value}
      onChange={(e) => onChange(line.line_no, field.key, e.target.value)}
    />
  );
}
