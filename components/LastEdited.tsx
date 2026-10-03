"use client";

import Link from "next/link";
import type { DocMeta } from "@/lib/docs";
import { wordsPages, wordsPagesTitle } from "@/lib/text";
import { ago, Cover } from "./Book";

/** The book written in last, over the shelves: one click to pick it up again. */
export default function LastEdited({ doc }: { doc: DocMeta }) {
  return (
    <section className="last-edited" aria-labelledby="last-edited-title">
      <h2 id="last-edited-title" className="label">
        Last edited
      </h2>
      <Link href={`/d/${doc.id}`} className="last-edited-card">
        <Cover doc={doc} />
        <span className="last-edited-text">
          <span className="book-title">{doc.title}</span>
          <span className="book-meta" title={wordsPagesTitle(doc.words)}>
            {wordsPages(doc.words)}
          </span>
          <span className="book-meta" suppressHydrationWarning>
            {ago(doc.modified, Date.now())}
          </span>
        </span>
      </Link>
    </section>
  );
}
