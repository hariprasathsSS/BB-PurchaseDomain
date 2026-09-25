import { useEffect, useRef, useState } from "react";

/* A free-typing text field with an app-styled suggestion dropdown under it —
   native <datalist> renders as plain, unstyleable browser chrome (a bare
   white box, a stock triangle marker) with essentially no CSS hook across
   browsers, so this swaps in a floating list built the same way the
   add-document menu is (see AddDocumentMenu.jsx — absolutely positioned,
   closes on an outside click). Still just a text input underneath: nothing
   here restricts what can be typed, the dropdown only ever offers a
   shortcut onto a value someone already knows exists. */
export function Combobox({ className = "input", value, onChange, options = [], ...rest }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = String(value ?? "").trim().toLowerCase();
  // Narrows as you type, but never to nothing just because the exact value
  // typed so far is already the whole match — the point is still to offer
  // the rest of the list, not to confirm what's already on screen.
  const shown = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;

  return (
    <div className="combo" ref={ref}>
      <input
        className={className}
        type="text"
        value={value ?? ""}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
        {...rest}
      />
      {open && shown.length ? (
        <div className="combo-menu">
          {shown.map((o) => (
            <button
              key={o}
              type="button"
              // mousedown, not click — fires before the input's own blur
              // would otherwise close this list first and swallow the pick.
              onMouseDown={(e) => { e.preventDefault(); onChange(o); setOpen(false); }}
            >
              {o}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
