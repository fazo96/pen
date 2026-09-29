"use client";

export type Heading = { pos: number; level: number; text: string };

type Props = {
  headings: Heading[];
  active: number | null;
  onJump: (h: Heading) => void;
};

export default function Outline({ headings, active, onJump }: Props) {
  if (headings.length === 0) {
    return <p className="outline-empty">Headings you write will gather here.</p>;
  }
  // Chapters (H2) are numbered, matching the counters drawn in the manuscript.
  const minLevel = Math.min(...headings.map((h) => h.level));
  let n = 0;

  return (
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
  );
}
