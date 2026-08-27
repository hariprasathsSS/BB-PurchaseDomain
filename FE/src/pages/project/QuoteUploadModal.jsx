import { useRef, useState } from "react";
import { Modal } from "../../components/Modal.jsx";
import { IconUpload } from "../../components/Icons.jsx";
import { api } from "../../lib/api.js";
import { ALLOWED_UPLOAD_RE, kb } from "../../lib/format.js";

/* One vendor, one quotation, always — a vendor doesn't send several
   quotations, so every file picked here becomes its own quotation upload,
   whether there's one file or ten. A multi-page quotation from a single
   vendor is one PDF file (its pages render server-side, unchanged), not
   several separate image files — the ambiguous case that used to prompt a
   choice here was several *photos*, and in practice that's always been
   different vendors' letters photographed in one go, never one vendor's
   letter split across loose photos. */
export function QuoteUploadModal({ project, onClose, onUploaded }) {
  const [picked, setPicked] = useState([]);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);

  const addFiles = (list) => {
    const rejected = [];
    const next = [...picked];
    for (const f of list) {
      if (!ALLOWED_UPLOAD_RE.test(f.name)) { rejected.push(f.name); continue; }
      if (!next.some((p) => p.name === f.name && p.size === f.size)) next.push(f);
    }
    setPicked(next);
    setErr(
      rejected.length
        ? `Skipped ${rejected.join(", ")} — only PDF, JPG and PNG files can be read.`
        : ""
    );
  };

  const send = async () => {
    if (!picked.length) return;
    setBusy(true);
    setErr("");
    setOk("");
    try {
      const results = await Promise.allSettled(
        picked.map((f) => api.uploadQuotation({ projectId: project.id, files: [f] }))
      );
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length === picked.length) {
        setErr(`Upload failed — ${failed[0].reason?.message ?? "unknown error"}. Nothing was saved; try again.`);
      } else {
        setOk(
          failed.length
            ? `${picked.length - failed.length} of ${picked.length} quotations uploaded — ${failed.length} failed`
              + ` (${failed[0].reason?.message ?? "unknown error"}). Reading the rest now.`
            : picked.length > 1
              ? `${picked.length} quotations uploaded. Reading them now — this updates automatically below.`
              : "Quotation uploaded. Reading it now — this updates automatically below."
        );
        setPicked([]);
        if (fileInput.current) fileInput.current.value = "";
      }
      await onUploaded();
    } catch (e) {
      setErr(`Upload failed — ${e.message}. Nothing was saved; try again.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Upload quotation"
      subtitle={`${project.code} — ${project.name}`}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn btn-out" onClick={onClose}>Close</button>
          <button className="btn btn-ink" onClick={send} disabled={busy || !picked.length}>
            {busy
              ? "Uploading…"
              : picked.length > 1 ? `Upload ${picked.length} quotations` : "Upload"}
          </button>
        </>
      }
    >
      {err ? <div className="banner banner-err">{err}</div> : null}
      {ok ? <div className="banner banner-ok">{ok}</div> : null}

      <div
        className={`drop ${over ? "over" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.current?.click(); }
        }}
        onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
      >
        <IconUpload width={26} height={26} />
        <div className="t">Choose files</div>
        <div className="d">
          A photo or PDF per vendor — pick several at once to upload that many quotations, one
          per file. Vendor, rates and grades are read automatically.
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept=".pdf,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf"
        capture="environment"
        onChange={(e) => addFiles(e.target.files)}
      />

      {picked.length ? (
        <ul className="filelist">
          {picked.map((f, i) => (
            <li key={`${f.name}-${f.size}`}>
              <span className="fname">{f.name}</span>
              <span className="fsize">{kb(f.size)}</span>
              <button
                className="drop-one"
                aria-label={`Remove ${f.name}`}
                onClick={() => setPicked(picked.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  );
}
