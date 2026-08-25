import { useRef, useState } from "react";
import { Modal } from "../../components/Modal.jsx";
import { IconUpload } from "../../components/Icons.jsx";
import { api } from "../../lib/api.js";
import { ALLOWED_UPLOAD_RE, kb } from "../../lib/format.js";

/* Browser intake: loose files against a project, and a site when the project
   has any — otherwise the document lands unfiled and nothing can group it. */
export function UploadModal({ project, onClose, onUploaded }) {
  const sites = project.sites ?? [];
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
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
      await api.uploadFiles({ projectId: project.id, siteId, files: picked });
      setOk(
        `${picked.length} file${picked.length > 1 ? "s" : ""} uploaded to ${project.code}. ` +
        "Extraction starts automatically."
      );
      setPicked([]);
      if (fileInput.current) fileInput.current.value = "";
      await onUploaded();
    } catch (e) {
      setErr(`Upload failed — ${e.message}. Nothing was saved; try again.`);
    } finally {
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
      {ok ? <div className="banner banner-ok">{ok}</div> : null}

      {sites.length ? (
        <div className="form" style={{ marginBottom: 24 }}>
          <label>
            <span>Site</span>
            <select className="input" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
      ) : null}

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
          Photos or PDFs of invoices, purchase orders and delivery challans.
          Drag them here or click to browse.
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept=".pdf,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf"
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
