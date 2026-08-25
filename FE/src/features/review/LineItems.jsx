import { LINE_FIELDS } from "./schema.js";
import { inr } from "../../lib/format.js";

/* The extracted line items. The material column is the important one: a bad
   automatic match is corrected here, which is what teaches the alias table. */
export function LineItems({ lines, materials, locked, onChange }) {
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
              {LINE_FIELDS.map((f) => <th key={f.key}>{f.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.line_no}>
                <td className="num">{line.line_no}</td>
                {LINE_FIELDS.map((field) => (
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
              </tr>
            ))}
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
