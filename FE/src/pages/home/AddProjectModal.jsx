import { useState } from "react";
import { Modal } from "../../components/Modal.jsx";
import { api } from "../../lib/api.js";

/* The project code is assigned by the backend, not typed here — so this asks
   only for a name and the sites that will be receiving documents. */
export function AddProjectModal({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [siteInput, setSiteInput] = useState("");
  const [sites, setSites] = useState([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const addSite = () => {
    const value = siteInput.trim();
    if (!value || sites.includes(value)) { setSiteInput(""); return; }
    setSites([...sites, value]);
    setSiteInput("");
  };

  const create = async () => {
    if (!name.trim()) { setErr("Project name is required."); return; }
    setBusy(true);
    setErr("");
    try {
      await api.createProject(name.trim(), sites);
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
          />
        </label>

        <label>
          <span>Sites</span>
          <div className="row">
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Foundation Area"
              value={siteInput}
              onChange={(e) => setSiteInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSite(); } }}
            />
            <button className="btn btn-out" type="button" onClick={addSite}>Add</button>
          </div>
          <span className="hint">
            Optional — but a document can only be filed to a site that exists.
          </span>
        </label>

        {sites.length ? (
          <ul className="filelist">
            {sites.map((s, i) => (
              <li key={s}>
                <span className="fname">{s}</span>
                <button
                  className="drop-one"
                  aria-label={`Remove ${s}`}
                  onClick={() => setSites(sites.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Modal>
  );
}
