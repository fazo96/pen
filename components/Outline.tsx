"use client";

import { roman, sceneNumber } from "@/lib/outline";

export type Heading = { pos: number; level: number; text: string };

type Props = {
  headings: Heading[];
  active: number | null;
  onJump: (h: Heading) => void;
  /** Codex entries: no part/chapter numbering, just indentation. */
  plain?: boolean;
};

// H1 = title, H2 = part, H3 = chapter, H4 = scene. Numbering matches the
// counters drawn in the manuscript: parts in roman numerals, chapters straight
// through, scenes within their chapter.
export default function Outline({ headings, active, onJump, plain = false }: Props) {
  if (headings.length === 0) {
    return <p className="outline-empty">Headings you write will gather here.</p>;
  }
  let part = 0;
  let chapter = 0;
  let scene = 0;

  return (
    <ol className="outline-list">
      {headings.map((h) => {
        const kind =
          h.level === 1 ? "title"
          : plain ? `note lvl-${h.level}`
          : h.level === 2 ? "part"
          : h.level === 3 ? "chapter"
          : "scene";
        if (kind === "chapter") scene = 0;
        const num =
          kind === "part" ? `Part ${roman(++part)}`
          : kind === "chapter" ? String(++chapter).padStart(2, "0")
          : kind === "scene" ? sceneNumber(chapter, ++scene)
          : "";
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
