import { useState } from "react";
import { Modal } from "../../components/Modal.jsx";
import { api } from "../../lib/api.js";

/* The project code is assigned by the backend, not typed here — so this
   asks only for a name. */
export function AddProjectModal({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) { setErr("Project name is required."); return; }
    setBusy(true);
    setErr("");
    try {
      await api.createProject(name.trim());
      await onCreated();
      onClose();
    } catch (e) {
      setErr(`Could not add the project — ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add project"
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn btn-out" onClick={onClose}>Cancel</button>
          <button className="btn btn-ink" onClick={create} disabled={busy}>
            {busy ? "Adding…" : "Add project"}
          </button>
        </>
      }
    >
      {err ? <div className="banner banner-err">{err}</div> : null}

      <div className="form">
        <label>
          <span>Project name</span>
          <input
            className="input"
            autoFocus
            placeholder="Chennai Residential Tower"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); create(); } }}
          />
        </label>
      </div>
    </Modal>
  );
}
