import { useMemo, useState } from "react";
import { FilterBar } from "../../components/FilterBar.jsx";
import { StatusPill, TypePill } from "../../components/Pills.jsx";
import { IconArrow, IconFile } from "../../components/Icons.jsx";
import {
  IMAGE_RE, isWaiting, matchesFilter, money, refOf, shortDate, siteNameOf,
} from "../../lib/format.js";

/* The document register: every scan and upload the console has taken, newest
   first, as a register rather than a gallery. A register is what this is —
   the question asked of it is "what came in, from whom, for how much, and
   what happened to it", and those are columns to be compared down the page,
   not captions under pictures. */
export function DocumentsTab({ docs, projects, search, onOpenDocument }) {
  const [filter, setFilter] = useState({ q: "", project: "", site: "", type: "", status: "" });

  /* The nav search applies here too, so typing a vendor anywhere finds it. */
  const effective = useMemo(() => ({ ...filter, q: filter.q || search }), [filter, search]);

  const shown = useMemo(
    () => docs.filter((d) => matchesFilter(d, effective)),
    [docs, effective]
  );

  const scanned = shown.filter((d) => d.source === "SCAN").length;
  const pending = shown.filter(isWaiting).length;

  return (
    <div className="band">
      <div className="col">
        <div className="pagetitle">
          <div>
            <span className="eyebrow">Capture history</span>
            <h1 style={{ marginTop: 14 }}>Document Register</h1>
            <p className="lede">
              Every document photographed on a site phone or uploaded from this
              desk, newest first, with the project and site it was filed against.
            </p>
          </div>
        </div>

        <div className="section">
          <FilterBar value={filter} onChange={setFilter} projects={projects} />

          <div className="section-head">
            <span className="tag">{shown.length} of {docs.length}</span>
            {scanned ? <span className="tag">{scanned} by phone</span> : null}
            {pending ? <span className="tag">{pending} still reading</span> : null}
          </div>

          <div className="dgrid reg">
            <div className="dhead">
              <span />
              <span>Document</span>
              <span>Status</span>
              <span>Vendor</span>
              <span>Project</span>
              <span>Site</span>
              <span>Reference</span>
              <span className="r">Amount</span>
              <span>Type</span>
              <span>Captured</span>
              <span />
            </div>

            {shown.length ? shown.map((d) => {
              const file = d.file_paths?.[0];
              const isImage = file && IMAGE_RE.test(file);
              return (
                <button
                  key={d.document_id}
                  className="drow"
                  type="button"
                  onClick={() => onOpenDocument(d.document_id)}
                  aria-label={`Review ${d.document_id}`}
                >
                  {/* A rectangular crop of the real page: enough to tell a
                      dense invoice from a one-line challan at a glance, and
                      it reads as a document rather than an avatar. */}
                  <span className="c-thumb">
                    {isImage
                      ? <img src={`/${file}`} alt="" loading="lazy" />
                      : <IconFile width={18} height={18} />}
                  </span>

                  <span className="c-id">{d.document_id.slice(0, 8)}</span>
                  <span><StatusPill status={d.status} /></span>
                  <span className="c-vend">{d.vendor_name ?? "—"}</span>
                  <span className="c-proj">{d.project_code ?? "—"}</span>
                  <span className="c-site">{siteNameOf(d, projects)}</span>
                  <span className="c-ref">{refOf(d) ?? "—"}</span>
                  {money(d.total_value)
                    ? <span className="c-amt">{money(d.total_value)}</span>
                    : <span className="c-amt pending">{isWaiting(d) ? "reading…" : "—"}</span>}
                  <span><TypePill type={d.document_type} /></span>
                  <span className="c-date">
                    {d.source === "SCAN" ? "Scanned" : "Uploaded"} {shortDate(d.uploaded_at)}
                  </span>
                  <span className="open-sm" aria-hidden="true">
                    <IconArrow width={18} height={18} />
                  </span>
                </button>
              );
            }) : (
              <div className="empty">
                {docs.length ? "No document matches these filters." : "Nothing captured yet."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
