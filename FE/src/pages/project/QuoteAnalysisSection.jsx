import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusPill } from "../../components/Pills.jsx";
import { IconCheck, IconClose, IconRefresh } from "../../components/Icons.jsx";
import { QuoteUploadModal } from "./QuoteUploadModal.jsx";
import { QuoteReviewModal } from "./QuoteReviewModal.jsx";
import { api } from "../../lib/api.js";
import { isWaiting, money, shortDate } from "../../lib/format.js";

/* One row per material, one cell per quotation that priced it — a vendor
   that quoted the same material twice keeps its cheaper line, but two
   different vendors quoting the same material both get their own cell.
   Building this once and having both the recommendation panel and the
   matrix below read from it keeps the two views in agreement by
   construction, rather than computing "the cheapest" twice.

   picks is {material_id: {quotation_id}} — a person's override, since grade
   and quality aren't numbers this can rank on their own. autoBest is always
   the cheapest quote; effective is autoBest unless a pick overrides it (and
   the picked quotation still actually prices this material — a stale pick
   just falls back silently rather than erroring). */
function aggregate(quotations, picks) {
  const byMaterial = new Map();

  for (const q of quotations) {
    if (q.status !== "EXTRACTED") continue;
    const vendorLabel = q.vendor_name_raw || `Quotation ${q.id.slice(-6)}`;

    for (const line of q.lines ?? []) {
      // No material match, or no rate printed — nothing to compare here.
      if (!line.material_id || line.rate == null) continue;

      if (!byMaterial.has(line.material_id)) {
        byMaterial.set(line.material_id, {
          materialId: line.material_id,
          name: line.material_name || line.description_raw,
          unit: line.material_unit || line.unit || "",
          cells: new Map(),
        });
      }
      const row = byMaterial.get(line.material_id);
      const existing = row.cells.get(q.id);
      if (!existing || line.rate < existing.rate) {
        row.cells.set(q.id, { quotationId: q.id, vendorLabel, rate: line.rate, grade: line.grade_raw });
      }
    }
  }

  const rows = [...byMaterial.values()]
    .map((row) => ({ ...row, cells: [...row.cells.values()] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const row of rows) {
    row.autoBest = row.cells.reduce((a, b) => (b.rate < a.rate ? b : a), row.cells[0]);
    const pickedId = picks[row.materialId]?.quotation_id;
    const picked = pickedId ? row.cells.find((c) => c.quotationId === pickedId) : null;
    row.effective = picked ?? row.autoBest;
    row.isOverridden = Boolean(picked && picked.quotationId !== row.autoBest.quotationId);
  }
  return rows;
}

/* uploading/setUploading come from ProjectDetail now — the button that
   flips it lives in the shared tab row up there (next to Purchase Orders /
   Materials / Quote Analysis), not down here, but the modal it opens still
   needs this section's own `reload` once it's done. */
export function QuoteAnalysisSection({ project, materials, uploading, setUploading }) {
  const [quotations, setQuotations] = useState([]);
  const [picks, setPicks] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [reviewingId, setReviewingId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const reload = useCallback(async () => {
    try {
      const [nextQuotations, nextPicks] = await Promise.all([
        api.listQuotations(project.id),
        api.listQuotePicks(project.id),
      ]);
      setQuotations(nextQuotations);
      setPicks(nextPicks);
      setErr("");
    } catch (e) {
      setErr(e.message || "could not load quotations");
    } finally {
      setLoaded(true);
    }
  }, [project.id]);

  useEffect(() => { reload(); }, [reload]);

  // Extraction runs in the background on the server — nothing pushes a
  // finished status to this screen, so it has to ask. Same shape as
  // ReviewModal's poll-while-waiting: reschedules itself only as long as
  // something is still PENDING/PROCESSING, so it stops on its own the
  // moment everything settles rather than polling forever.
  useEffect(() => {
    if (!quotations.some(isWaiting)) return;
    const timer = setTimeout(reload, 3000);
    return () => clearTimeout(timer);
  }, [quotations, reload]);

  const rows = useMemo(() => aggregate(quotations, picks), [quotations, picks]);
  // Every quotation that priced at least one matched material, in the order
  // it first appears — the matrix's column set, computed once rather than
  // once per row.
  const vendorColumns = useMemo(
    () => [...new Map(rows.flatMap((r) => r.cells).map((c) => [c.quotationId, c.vendorLabel]))],
    [rows]
  );

  const doDelete = async (id) => {
    setConfirmDelete(null);
    try {
      await api.deleteQuotation(id);
      await reload();
    } catch (e) {
      setErr(`Could not remove — ${e.message}`);
    }
  };

  const doRetry = async (id) => {
    await api.retryQuotationExtraction(id);
    await reload();
  };

  // A person's manual call on which vendor to buy a material from — grade
  // and quality aren't something the app can rank, so this is the one place
  // that overrides cheapest-wins.
  const clearPick = async (materialId) => {
    try {
      await api.clearQuotePick(project.id, materialId);
      await reload();
    } catch (e) {
      setErr(`Could not update the pick — ${e.message}`);
    }
  };

  // Clicking the cell already in effect clears an override back to auto —
  // "back to auto" rather than "pin to today's cheapest" matters here: a
  // cheaper quote uploaded later should win on its own, not sit ignored
  // because an old cheapest got pinned in by name. Clicking it when it's
  // already the natural cheapest does nothing, since there's no override to
  // clear. Clicking any other cell sets it as the pick.
  const pickCell = async (materialId, cell, row) => {
    if (cell.quotationId === row.effective.quotationId) {
      if (row.isOverridden) await clearPick(materialId);
      return;
    }
    try {
      const reviewer = localStorage.getItem("reviewerName") || "";
      await api.setQuotePick(project.id, materialId, cell.quotationId, reviewer);
      await reload();
    } catch (e) {
      setErr(`Could not update the pick — ${e.message}`);
    }
  };

  if (!loaded) return <div className="card"><div className="empty">Loading…</div></div>;

  return (
    <>
      {err ? <div className="banner banner-err" style={{ marginBottom: 16 }}>{err}</div> : null}

      {!quotations.length ? (
        <div className="card">
          <div className="empty">
            No quotations yet — upload one from each vendor to compare their rates.
          </div>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="table-wrap">
              <table className="data quote-list">
                {/* table-layout:fixed with the actions column already sized
                    for its own longest state (the "Remove this quotation?"
                    confirm) — see app.css. Without this, that column's
                    width is driven by content across every row at once, so
                    one row entering confirm mode widened the whole column
                    and shifted every other row along with it. */}
                <colgroup>
                  <col />
                  <col style={{ width: "160px" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "130px" }} />
                  <col style={{ width: "90px" }} />
                  <col style={{ width: "300px" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Quote no.</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th className="num">Pages</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {quotations.map((q) => (
                    <tr key={q.id}>
                      <td>
                        <button className="row-link" type="button" onClick={() => setReviewingId(q.id)}>
                          {q.vendor_name_raw || "— not yet read —"}
                        </button>
                      </td>
                      <td className="mono">{q.quote_number ?? "—"}</td>
                      <td className="c-date">{shortDate(q.uploaded_at)}</td>
                      <td><StatusPill status={q.status} /></td>
                      <td className="num">{q.page_count}</td>
                      <td className="r">
                        {confirmDelete === q.id ? (
                          <span className="row-actions">
                            Remove this quotation?
                            <button
                              className="row-link go"
                              type="button"
                              title="Confirm"
                              aria-label="Confirm removing this quotation"
                              onClick={() => doDelete(q.id)}
                            >
                              <IconCheck width={16} height={16} />
                            </button>
                            <button
                              className="row-link stop"
                              type="button"
                              title="Cancel"
                              aria-label="Cancel"
                              onClick={() => setConfirmDelete(null)}
                            >
                              <IconClose width={16} height={16} />
                            </button>
                          </span>
                        ) : (
                          <span className="row-actions">
                            {q.status === "FAILED" ? (
                              <button className="row-link" type="button" onClick={() => doRetry(q.id)}>
                                <IconRefresh width={13} height={13} />
                                Retry
                              </button>
                            ) : null}
                            <button className="row-link warn" type="button" onClick={() => setConfirmDelete(q.id)}>
                              Remove
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {!rows.length ? (
            <div className="card">
              <div className="empty">
                Still reading — the comparison appears once a quotation finishes and at least
                one line matches a known material.
              </div>
            </div>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 24 }}>
                <div className="recommend-head">
                  <h3>Recommended purchase</h3>
                  <span className="d">
                    Cheapest quoted rate per material by default — click any rate in the table
                    below to buy that material from a different vendor instead.
                  </span>
                </div>
                <ul className="recommend-list">
                  {rows.map((row) => (
                    <li key={row.materialId}>
                      <span className="rec-mat">{row.name}</span>
                      <span className="rec-arrow">→</span>
                      <span className="rec-vendor">{row.effective.vendorLabel}</span>
                      <span className="rec-rate">
                        {money(row.effective.rate)}{row.unit ? ` / ${row.unit}` : ""}
                      </span>
                      {row.effective.grade ? <span className="rec-grade">{row.effective.grade}</span> : null}
                      {row.isOverridden ? (
                        <>
                          <span className="rec-manual">picked, not cheapest</span>
                          <span className="rec-alt">
                            cheapest was {row.autoBest.vendorLabel} at {money(row.autoBest.rate)}
                          </span>
                          <button className="row-link" type="button" onClick={() => clearPick(row.materialId)}>
                            Use cheapest
                          </button>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="card">
                <div className="table-wrap">
                  <table className="data rollup quote-matrix">
                    <thead>
                      <tr>
                        <th>Material</th>
                        {/* .r, not .num — right-aligned to match the rate
                            cells below it, but a vendor name isn't a number
                            and shouldn't render in the mono digit face. */}
                        {vendorColumns.map(([qid, label]) => <th key={qid} className="r">{label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.materialId}>
                          <td className="c-mat">
                            {row.name}
                            {row.unit ? <span className="unit"> / {row.unit}</span> : null}
                          </td>
                          {vendorColumns.map(([qid]) => {
                            const cell = row.cells.find((c) => c.quotationId === qid);
                            if (!cell) return <td key={qid} className="num mute">—</td>;
                            const isEffective = cell.quotationId === row.effective.quotationId;
                            const isCheapest = cell.quotationId === row.autoBest.quotationId;
                            return (
                              <td key={qid} className={`num quote-cell ${isEffective ? "ok strong" : ""}`}>
                                <button
                                  type="button"
                                  className="quote-cell-btn"
                                  onClick={() => pickCell(row.materialId, cell, row)}
                                  title={
                                    isEffective
                                      ? row.isOverridden
                                        ? "Manually picked — click to go back to cheapest"
                                        : "Cheapest quote"
                                      : "Click to buy this material from this vendor instead"
                                  }
                                >
                                  {money(cell.rate)}
                                  {cell.grade ? <div className="cell-grade">{cell.grade}</div> : null}
                                  {isEffective && row.isOverridden ? (
                                    <div className="cell-flag">picked</div>
                                  ) : !isEffective && isCheapest && row.isOverridden ? (
                                    <div className="cell-flag mute">cheapest</div>
                                  ) : null}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {uploading ? (
        <QuoteUploadModal project={project} onClose={() => setUploading(false)} onUploaded={reload} />
      ) : null}

      {reviewingId ? (
        <QuoteReviewModal
          key={reviewingId}
          quotationId={reviewingId}
          materials={materials}
          onClose={() => setReviewingId(null)}
          onChanged={reload}
        />
      ) : null}
    </>
  );
}
