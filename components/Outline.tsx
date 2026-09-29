"use client";

export type Heading = { pos: number; level: number; text: string };

type Props = {
  headings: Heading[];
  active: number | null;
  onJump: (h: Heading) => void;
  /** Codex entries: no part/chapter numbering, just indentation. */
  plain?: boolean;
};

const ROMAN: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

function roman(n: number) {
  let out = "";
  for (const [v, s] of ROMAN) while (n >= v) (out += s), (n -= v);
  return out;
}

// H1 = title, H2 = part, H3 = chapter. Numbering matches the counters drawn
// in the manuscript: parts in roman numerals, chapters straight through.
export default function Outline({ headings, active, onJump, plain = false }: Props) {
  if (headings.length === 0) {
    return <p className="outline-empty">Headings you write will gather here.</p>;
  }
  let part = 0;
  let chapter = 0;

  return (
    <ol className="outline-list">
      {headings.map((h) => {
        const kind = h.level === 1 ? "title" : plain ? `note lvl-${h.level}` : h.level === 2 ? "part" : "chapter";
        const num = plain ? "" : kind === "part" ? `Part ${roman(++part)}` : kind === "chapter" ? String(++chapter).padStart(2, "0") : "";
        return (
          <li key={h.pos}>
            <button
              type="button"
              className={`outline-item is-${kind} ${active === h.pos ? "is-active" : ""}`}
              onClick={() => onJump(h)}
            >
              <span className="outline-num">{num}</span>
              <span className="outline-text">{h.text || "Untitled"}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
