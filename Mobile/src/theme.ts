/**
 * Design tokens — mirrored from FE/src/styles/tokens.css so the phone and
 * the web console read as one product. Change a value here and there, not
 * in the screens.
 *
 * `accent` is a lighter tint of the web's steel-blue than the web itself
 * uses — the web paints it on a light canvas, the phone paints it on the
 * dark navy app bar and the camera overlay, where a flat match wouldn't
 * read at all. Same hue, tuned for where it actually sits.
 */
export const T = {
  navy: '#14202e',
  navySoft: '#223244',
  accent: '#7fa8cc',

  page: '#eef1f4',
  card: '#ffffff',
  border: '#d7dde3',
  borderSoft: '#e7ebf0',
  rowHover: '#f4f6f8',

  text: '#14202e',
  muted: '#4c5a6b',
  invert: '#f4f7f9',

  ok: '#1f5c34',
  okBg: '#d7ecdc',
  blue: '#2f5578',
  blueDark: '#24466a',
  red: '#9e2b1f',

  radius: 12,
  radiusSm: 8,
} as const;

export const DOC_TYPES = ['INVOICE', 'PO', 'DELIVERY'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_LABEL: Record<DocType, string> = {
  INVOICE: 'Invoice',
  PO: 'Purchase Order',
  DELIVERY: 'Delivery',
};

/* Same pill palette as the web table — Invoice/Delivery reuse the web's
   info/ok semantic pair exactly; PO gets its own hue (violet sits unused
   elsewhere in the palette) since it's the type this app now goes out of
   its way to make easy to pick correctly. */
export const DOC_PILL: Record<DocType, { bg: string; fg: string }> = {
  INVOICE: { bg: '#dde7f0', fg: '#24466a' },
  PO: { bg: '#e8e3f2', fg: '#4a3a7a' },
  DELIVERY: { bg: '#d7ecdc', fg: '#1f5c34' },
};
