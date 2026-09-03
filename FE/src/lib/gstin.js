/* Client-side port of extract.py's gstin_checksum_ok/gstin_is_self — the
   review screen needs these to re-check a GSTIN the moment a reviewer edits
   it, not just once at load time (see GstinChecksumBanner in ReviewModal.jsx:
   the server-computed vendor_gstin_checksum_ok that ships with the document
   describes the *original* extracted value, and goes stale the instant the
   field is corrected). Keep in sync with extract.py if the algorithm changes. */

const CHECKSUM_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function gstinChecksumOk(value) {
  if (!value || value.length !== 15) return null;
  const v = value.toUpperCase();
  let total = 0;
  let factor = 1;
  for (let i = 0; i < 14; i++) {
    const code = CHECKSUM_CHARS.indexOf(v[i]);
    if (code === -1) return null;
    let d = factor * code;
    d = Math.floor(d / 36) + (d % 36);
    total += d;
    factor = factor === 1 ? 2 : 1;
  }
  const expected = CHECKSUM_CHARS[(36 - (total % 36)) % 36];
  return v[14] === expected;
}

// B&B's own PAN — chars 3-12 of any GSTIN they hold, in any state. See
// extract.py's _SELF_PAN for the confirmed real-sample list this is from.
const SELF_PAN = "AADCB4217G";

export function gstinIsSelf(value) {
  if (!value || value.length !== 15) return false;
  const pan = value.toUpperCase().slice(2, 12);
  let diff = 0;
  for (let i = 0; i < SELF_PAN.length; i++) {
    if (pan[i] !== SELF_PAN[i]) diff++;
  }
  return diff <= 2;
}
