/* Stroke-based icons on a 24px grid, one consistent weight. Inline SVG rather
   than emoji: emoji render differently per OS and cannot take a brand colour. */

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export const IconUpload = (p) => (
  <svg {...base} {...p}>
    <path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 18v2h16v-2" />
  </svg>
);

/* Upload's arrow, reversed — the pair reads as in and out of the system. */
export const IconDownload = (p) => (
  <svg {...base} {...p}>
    <path d="M12 4v12" /><path d="M7 11l5 5 5-5" /><path d="M4 18v2h16v-2" />
  </svg>
);

export const IconFolder = (p) => (
  <svg {...base} {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

export const IconGallery = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <circle cx="8.5" cy="9.5" r="1.6" /><path d="M4 17l5-4 4 3 3-2 4 3" />
  </svg>
);

export const IconArrow = (p) => (
  <svg {...base} {...p}><path d="M5 12h13" /><path d="M12 6l6 6-6 6" /></svg>
);

export const IconPlus = (p) => (
  <svg {...base} {...p}><path d="M12 5v14" /><path d="M5 12h14" /></svg>
);

export const IconClose = (p) => (
  <svg {...base} {...p}><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
);

export const IconRefresh = (p) => (
  <svg {...base} {...p}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" />
  </svg>
);

export const IconPhone = (p) => (
  <svg {...base} {...p}>
    <rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M11 18.5h2" />
  </svg>
);

export const IconPrint = (p) => (
  <svg {...base} {...p}>
    <path d="M7 8V4h10v4" /><rect x="4" y="8" width="16" height="7" rx="2" />
    <path d="M7 15h10v5H7z" />
  </svg>
);

export const IconFile = (p) => (
  <svg {...base} {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);

export const IconBack = (p) => (
  <svg {...base} {...p}><path d="M19 12H6" /><path d="M12 6l-6 6 6 6" /></svg>
);

export const IconHome = (p) => (
  <svg {...base} {...p}><path d="M4 11l8-7 8 7" /><path d="M6 10v9h12v-9" /></svg>
);

export const IconSearch = (p) => (
  <svg {...base} {...p}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
);

export const IconCheck = (p) => (
  <svg {...base} {...p}><path d="M20 6L9 17l-5-5" /></svg>
);

/* Rotated 90deg via .is-open rather than swapped for a down-chevron: one
   element, one transition, instead of two icons crossfading. */
export const IconChevron = (p) => (
  <svg {...base} {...p}><path d="M9 6l6 6-6 6" /></svg>
);
