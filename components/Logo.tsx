import { useId } from "react";

/**
 * pen's mark: a fountain-pen nib pointing top right. The same shapes as
 * design/logo.svg, without the tile and in the theme's colours; the slit
 * and breather hole are cut out so the bar shows through.
 */
export default function Logo({ size = 26 }: { size?: number }) {
  const cut = useId();
  return (
    <svg viewBox="11 13 78 78" width={size} height={size} aria-hidden focusable="false">
      <defs>
        <mask id={cut}>
          <rect x="0" y="0" width="100" height="100" fill="#fff" />
          <rect x="49.25" y="12" width="1.5" height="34" fill="#000" />
          <circle cx="50" cy="48" r="3.4" fill="#000" />
        </mask>
      </defs>
      <g transform="rotate(45 50 50) translate(0 -1)">
        <rect x="38" y="72" width="24" height="22" rx="4" fill="var(--ink)" />
        <rect x="35" y="68" width="30" height="6" rx="1.5" fill="var(--ink)" />
        <path d="M50 8C54 20 64 34 64 50L62 70H38L36 50C36 34 46 20 50 8Z" fill="var(--accent)" mask={`url(#${cut})`} />
      </g>
    </svg>
  );
}
