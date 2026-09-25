import { useCallback, useEffect, useState } from "react";
import { Modal } from "../../components/Modal.jsx";
import { HeaderFields } from "../../features/review/HeaderFields.jsx";
import { LineItems } from "../../features/review/LineItems.jsx";
import { QUOTE_HEADER_FIELDS, QUOTE_HEADER_SECTIONS, QUOTE_LINE_FIELDS } from "../../features/review/schema.js";
import { api } from "../../lib/api.js";
import { isWaiting } from "../../lib/format.js";

const blank = (v) => (typeof v === "string" && v.trim() === "" ? null : v === "" ? null : v);
const HEADER_KEYS = QUOTE_HEADER_FIELDS.map((f) => f.key);

/* A quotation's own review screen — correcting what the extractor read off a
   vendor's price list. No approve/reject: unlike a document, a quotation is
   never the business's own record of a decision, only an input to the
   comparison. Save is the only verdict this screen has. */
function buildEdits(draft) {
  const header = {};
  HEADER_KEYS.forEach((key) => { header[key] = blank(draft.header[key] ?? ""); });

  const lines = draft.lines.map((line) => {
    const out = { line_no: line.line_no };
    QUOTE_LINE_FIELDS.forEach((f) => { out[f.key] = blank(line[f.key] ?? ""); });
    return out;
  });

  return { header, lines };
}

export function QuoteReviewModal({ quotationId, materials, onClose, onChanged }) {
  const [quote, setQuote] = useState(null);
  const [draft, setDraft] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  /* Same load-then-poll-while-waiting shape as ReviewModal — stops itself
     the moment extraction settles, so nothing polls once the form is up. */
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let watched = false;

    const read = async () => {
      const fresh = await api.getQuotation(quotationId).catch(() => null);
      if (cancelled || !fresh) return;
      setQuote(fresh);

      if (isWaiting(fresh)) {
        watched = true;
        timer = setTimeout(read, 3000);
      } else if (watched) {
        onChanged();
      }
    };

    read();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [quotationId, onChanged]);

  useEffect(() => {
    if (!quote || isWaiting(quote)) return;
    setDraft((prev) => prev ?? {
      header: Object.fromEntries(HEADER_KEYS.map((k) => [k, quote[k]])),
      lines: (quote.lines ?? []).map((l) => ({ ...l })),
    });
  }, [quote]);

  const setHeader = (key, value) =>
    setDraft((d) => ({ ...d, header: { ...d.header, [key]: value } }));

  const setLine = (lineNo, key, value) =>
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l) => (l.line_no === lineNo ? { ...l, [key]: value } : l)),
    }));

  const save = useCallback(async () => {
    setErr("");
    setBusy(true);
    try {
      const updated = await api.saveQuotation(quotationId, buildEdits(draft));
      setQuote(updated);
      onChanged();
    } catch (e) {
      setErr(`Could not save — ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [quotationId, draft, onChanged]);

  const retry = async () => {
    await api.retryQuotationExtraction(quotationId);
    setQuote(await api.getQuotation(quotationId).catch(() => quote));
    onChanged();
  };

  const subtitle = quote ? `${quote.id} — ${quote.vendor_name_raw || "vendor not yet read"}` : quotationId;

  return (
    <Modal title="Review quotation" subtitle={subtitle} wide onClose={onClose}>
      {!quote ? <div className="empty">Loading…</div> : (
        <>
          <div className="doc-pages">
            {quote.file_paths.map((path) => (
              <a key={path} href={`/${path}`} target="_blank" rel="noopener noreferrer">
                <img src={`/${path}`} alt="quotation page" />
              </a>
            ))}
          </div>

          {isWaiting(quote) ? (
            <div className="banner banner-wait">Reading this quotation… this updates automatically.</div>
          ) : quote.status === "FAILED" ? (
            <div className="banner banner-err">
              Extraction failed — {quote.error || "unknown error"}.
              <div style={{ marginTop: 10 }}>
                <button className="btn btn-out" onClick={retry}>Retry extraction</button>
              </div>
            </div>
          ) : draft ? (
            <>
              <HeaderFields
                header={draft.header}
                locked={false}
                onChange={setHeader}
                sections={QUOTE_HEADER_SECTIONS}
              />
              <LineItems
                lines={draft.lines}
                materials={materials}
                locked={false}
                onChange={setLine}
                fields={QUOTE_LINE_FIELDS}
              />

              <div className="field-section">
                <div className="reviewer-row">
                  <div className="spacer" />
                  <button className="btn btn-out" onClick={onClose}>Close</button>
                  <button className="btn btn-ink" onClick={save} disabled={busy}>
                    {busy ? "Saving…" : "Save changes"}
                  </button>
                </div>
                {err ? <div className="banner banner-err" style={{ marginTop: 16 }}>{err}</div> : null}
              </div>
            </>
          ) : null}
        </>
      )}
    </Modal>
  );
}
