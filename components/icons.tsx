// Hairline icons, drawn on a 20×20 grid to match the mono UI type.
type P = React.SVGProps<SVGSVGElement>;

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.25,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export const IconQuote = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 5v10M8 7h8M8 10h8M8 13h5" />
  </svg>
);

export const IconBullets = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="4.5" cy="6" r=".6" fill="currentColor" />
    <circle cx="4.5" cy="10" r=".6" fill="currentColor" />
    <circle cx="4.5" cy="14" r=".6" fill="currentColor" />
    <path d="M8 6h8M8 10h8M8 14h8" />
  </svg>
);

export const IconNumbers = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3.5 4.5h1v3M3.5 12.2c.3-.5 1.6-.6 1.6.3 0 .7-1.6 1.5-1.6 2.3h1.8M8 6h8M8 10h8M8 14h8" />
  </svg>
);

export const IconUndo = (p: P) => (
  <svg {...base} {...p}>
    <path d="M7 5 3.5 8.5 7 12M3.5 8.5H12a4.5 4.5 0 0 1 0 9H9" />
  </svg>
);

export const IconRedo = (p: P) => (
  <svg {...base} {...p}>
    <path d="m13 5 3.5 3.5L13 12M16.5 8.5H8a4.5 4.5 0 0 0 0 9h3" />
  </svg>
);

export const IconOutline = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3.5 5h13M6.5 10h10M9.5 15h7" />
  </svg>
);

export const IconExport = (p: P) => (
  <svg {...base} {...p}>
    <path d="M10 3.5v9M6.5 9 10 12.5 13.5 9M4 16.5h12" />
  </svg>
);

export const IconTheme = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="10" cy="10" r="6" />
    <path d="M10 4a6 6 0 0 1 0 12z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconClose = (p: P) => (
  <svg {...base} {...p}>
    <path d="m5 5 10 10M15 5 5 15" />
  </svg>
);

export const IconTrash = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6M8.7 8.5v4.5M11.3 8.5v4.5" />
  </svg>
);

export const IconImport = (p: P) => (
  <svg {...base} {...p}>
    <path d="M10 12.5v-9M6.5 7 10 3.5 13.5 7M4 16.5h12" />
  </svg>
);

export const IconPlus = (p: P) => (
  <svg {...base} {...p}>
    <path d="M10 4v12M4 10h12" />
  </svg>
);

export const IconBack = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 5 7 10l5 5" />
  </svg>
);

export const IconFocus = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4" />
  </svg>
);

export const IconUnfocus = (p: P) => (
  <svg {...base} {...p}>
    <path d="M7.5 3.5v4h-4M16.5 7.5h-4v-4M12.5 16.5v-4h4M3.5 12.5h4v4" />
  </svg>
);

export const IconLock = (p: P) => (
  <svg {...base} {...p}>
    <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
    <path d="M7 9V6.5a3 3 0 0 1 6 0V9M10 12.3v1.8" />
  </svg>
);

/** Construct: a small armillary, rings around a point. */
export const IconConstruct = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none" />
    <ellipse cx="10" cy="10" rx="7" ry="3" />
    <ellipse cx="10" cy="10" rx="3" ry="7" />
  </svg>
);

export const IconSend = (p: P) => (
  <svg {...base} {...p}>
    <path d="M10 16V4M5 9l5-5 5 5" />
  </svg>
);

export const IconStop = (p: P) => (
  <svg {...base} {...p}>
    <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />
  </svg>
);

export const IconChats = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6M3.5 3.5v2.4h2.4M10 6.5V10l2.5 1.5" />
  </svg>
);

export const IconSettings = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3.5 6h8M15 6h1.5M3.5 14H5M8.5 14h8" />
    <circle cx="13.2" cy="6" r="1.8" />
    <circle cx="6.8" cy="14" r="1.8" />
  </svg>
);

export const IconMore = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="5" cy="10" r=".7" fill="currentColor" />
    <circle cx="10" cy="10" r=".7" fill="currentColor" />
    <circle cx="15" cy="10" r=".7" fill="currentColor" />
  </svg>
);

export const IconImage = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="4.5" width="13" height="11" rx="1.5" />
    <circle cx="7.5" cy="8.5" r="1.2" />
    <path d="m4 14.5 4-4 3 3 2-2 3.5 3.5" />
  </svg>
);

export const IconPencil = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12.5 4.5l3 3L7.5 15.5l-3.7.7.7-3.7zM11 6l3 3" />
  </svg>
);

/** Open in full: an arrow leaving a box. */
export const IconExpand = (p: P) => (
  <svg {...base} {...p}>
    <path d="M11 4h5v5M16 4l-7 7M14 12v3.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5H8" />
  </svg>
);

export const IconUp = (p: P) => (
  <svg {...base} {...p}>
    <path d="m5 12.5 5-5 5 5" />
  </svg>
);

export const IconDown = (p: P) => (
  <svg {...base} {...p}>
    <path d="m5 7.5 5 5 5-5" />
  </svg>
);

export const IconGrammar = (p: P) => (
  <svg {...base} {...p}>
    <path d="m5 8.5 3 3 6-6.5M3 15.5c1.2-1.2 2.3-1.2 3.5 0s2.3 1.2 3.5 0 2.3-1.2 3.5 0 2.3 1.2 3.5 0" />
  </svg>
);

export const IconGear = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="10" cy="10" r="2.4" />
    <path d="M10 2.8v1.9M10 15.3v1.9M17.2 10h-1.9M4.7 10H2.8M15.1 4.9l-1.35 1.35M6.25 13.75 4.9 15.1M15.1 15.1l-1.35-1.35M6.25 6.25 4.9 4.9" />
    <circle cx="10" cy="10" r="5.3" />
  </svg>
);

/** A stack of books. */
export const IconBooks = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="13" width="13" height="3.5" rx=".5" />
    <rect x="4.5" y="9" width="11" height="4" rx=".5" />
    <rect x="3.8" y="5" width="12" height="4" rx=".5" transform="rotate(-4 10 7)" />
  </svg>
);

/** Books on a shelf, one leaning. */
export const IconShelf = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 16h14M5 16V6h2.5v10M8.5 16V4H11v12M12.5 16l1.6-9.2 2.3.4-1.4 8.8" />
  </svg>
);

/** GitHub's mark, filled: an outline of it doesn't read at this size. */
export const IconGithub = (p: P) => (
  <svg {...base} stroke="none" fill="currentColor" {...p}>
    <path
      transform="translate(2.5 2.5) scale(.9375)"
      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
    />
  </svg>
);
