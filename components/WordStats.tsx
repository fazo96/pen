"use client";

import { useRef, useState } from "react";
import { useDismiss } from "@/lib/useDismiss";
import { WORDS_PER_PAGE, pageCount, readMinutes } from "@/lib/text";

type Props = {
  words: number;
  /** Text before the counts, e.g. the save status. */
  lead?: string;
  /** Where the explanation opens. */
  side?: "above" | "below";
};

/** "12,345 w · 54 min · 49 p", explained on hover or tap. */
export default function WordStats({ words, lead, side = "below" }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const pages = pageCount(words);
  const minutes = readMinutes(words);

  useDismiss(open, root, () => setOpen(false), { escapeFirst: true });

  return (
    <span className={`word-stats is-${side} ${open ? "is-open" : ""}`} ref={root}>
      <button type="button" className="word-stats-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {lead && `${lead} · `}
        {words.toLocaleString()} w · {minutes} min · {pages.toLocaleString()} p
      </button>
      <span className="word-stats-pop" role="tooltip">
        <span>
          <b>w</b> {words.toLocaleString()} {words === 1 ? "word" : "words"}, not counting comments
        </span>
        <span>
          <b>min</b> about {minutes} {minutes === 1 ? "minute" : "minutes"} to read
        </span>
        <span>
          <b>p</b> about {pages.toLocaleString()} manuscript {pages === 1 ? "page" : "pages"}, at {WORDS_PER_PAGE} words a page
        </span>
      </span>
    </span>
  );
}
