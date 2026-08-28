import { useRef, useState } from "react";
import { Modal } from "../../components/Modal.jsx";
import { IconUpload } from "../../components/Icons.jsx";
import { api } from "../../lib/api.js";
import { ALLOWED_UPLOAD_RE, kb } from "../../lib/format.js";

/* Browser intake: loose files against a project — no document-type hint
   from here — the classifier reads every upload itself (see extract.py's
   SYSTEM prompt), and a wrong hint from a human filing it as the wrong kind
   is worse than no hint at all.

   Upload used to fire-and-forget: close this dialog, show a toast, and leave
   extraction to finish silently in the background. It doesn't anymore — the
   moment the upload succeeds, this closes and hands the new document ids
   back so the caller can open each one straight into Review, the same way
   clicking an existing document does. Review's own polling already covers
   the "extraction is still running" wait, so nothing here needs to. */
export function UploadModal({ project, onClose, onUploaded }) {
  const [picked, setPicked] = useState([]);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState("");
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
    try {
      const result = await api.uploadFiles({ projectId: project.id, files: picked });
      const ids = (result.documents ?? []).map((d) => d.document_id);
      onUploaded(ids);
      onClose();
    } catch (e) {
      setErr(`Upload failed — ${e.message}. Nothing was saved; try again.`);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Upload files"
      subtitle={`${project.code} — ${project.name}`}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn btn-out" onClick={onClose}>Close</button>
          <button className="btn btn-ink" onClick={send} disabled={busy || !picked.length}>
            {busy
              ? "Uploading…"
              : picked.length > 1 ? `Upload ${picked.length} files` : "Upload"}
          </button>
        </>
      }
    >
      {err ? <div className="banner banner-err">{err}</div> : null}

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
          Photos or PDFs of invoices, purchase orders and delivery challans. Drag them here or
          click to browse — the document type is read automatically.
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
