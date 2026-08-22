/**
 * Design tokens — mirrored from FE/index.html so the phone and the web console
 * read as one product. Change a value here and there, not in the screens.
 */
export const T = {
  navy: '#16273b',
  navySoft: '#22364f',
  gold: '#e9a13b',

  page: '#eef1f5',
  card: '#ffffff',
  border: '#d7dee7',
  borderSoft: '#e8edf3',
  rowHover: '#f5f8fb',

  text: '#1f2d3d',
  muted: '#7b8794',
  invert: '#ffffff',

  green: '#2f9e63',
  greenDark: '#278653',
  blue: '#2c7be5',
  blueDark: '#1a5fb4',
  red: '#e34a3a',

  radius: 10,
  radiusSm: 6,
} as const;

export const DOC_TYPES = ['INVOICE', 'PO', 'DELIVERY'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_LABEL: Record<DocType, string> = {
  INVOICE: 'Invoice',
  PO: 'Purchase Order',
  DELIVERY: 'Delivery',
};

/** Same pill palette as the web table. */
export const DOC_PILL: Record<DocType, { bg: string; fg: string }> = {
  INVOICE: { bg: '#e7effb', fg: '#1a5fb4' },
  PO: { bg: '#ede8fa', fg: '#5533b8' },
  DELIVERY: { bg: '#e2f4ea', fg: '#1d7245' },
};
