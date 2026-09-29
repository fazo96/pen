"use client";

import { IconClose } from "./icons";

export type Heading = { pos: number; level: number; text: string };

type Props = {
  headings: Heading[];
  active: number | null;
  open: boolean;
  words: number;
  onJump: (h: Heading) => void;
  onClose: () => void;
};

export default function Outline({ headings, active, open, words, onJump, onClose }: Props) {
  // Chapters (H2) are numbered, matching the counters drawn in the manuscript.
  const minLevel = Math.min(...headings.map((h) => h.level));
  let n = 0;

  return (
    <>
      <div className={`scrim ${open ? "is-open" : ""}`} onClick={onClose} aria-hidden />
      <nav className={`outline ${open ? "is-open" : ""}`} aria-label="Outline">
        <div className="outline-head">
          <span className="label">Outline</span>
          <button type="button" className="icon-btn outline-close" onClick={onClose} aria-label="Close outline">
            <IconClose />
          </button>
        </div>
        {headings.length === 0 ? (
          <p className="outline-empty">Headings you write will gather here.</p>
        ) : (
          <ol className="outline-list">
            {headings.map((h) => {
              const numbered = h.level === 2;
              if (numbered) n += 1;
              return (
                <li key={h.pos}>
                  <button
                    type="button"
                    className={`outline-item lvl-${h.level - minLevel} ${active === h.pos ? "is-active" : ""}`}
                    onClick={() => onJump(h)}
                  >
                    <span className="outline-num">{numbered ? String(n).padStart(2, "0") : ""}</span>
                    <span className="outline-text">{h.text || "Untitled"}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        <div className="outline-foot label">
          {words.toLocaleString()} words · {Math.max(1, Math.round(words / 230))} min read
        </div>
      </nav>
    </>
  );
}
