"use client";

import Link from "next/link";
import { useState } from "react";
import { isImage } from "@/lib/cover";
import type { DocMeta } from "@/lib/types";
import { wordsPages, wordsPagesTitle } from "@/lib/text";
import { IconGear } from "./icons";

export function ago(ms: number, now: number) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Book cloths for manuscripts without cover art, picked by a hash of the id
// so a book keeps its colour.
const CLOTHS = ["#6e2a22", "#243049", "#2f4a3a", "#8a5a1e", "#4a2b45", "#35454f", "#1f4d4d", "#5a3a28"];
function clothOf(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return CLOTHS[Math.abs(h) % CLOTHS.length];
}

/** The front board: cover art, or a cloth edition with the title. */
export function Cover({ doc }: { doc: DocMeta }) {
  return (
    <span className="book-cover" style={{ "--cloth": clothOf(doc.id) } as React.CSSProperties}>
      {doc.cover ? (
        // eslint-disable-next-line @next/next/no-img-element -- served by our own route, already sized
        <img src={`/api/docs/${doc.id}/cover?v=${Math.round(doc.cover)}`} alt="" loading="lazy" decoding="async" draggable={false} />
      ) : (
        <span className="book-plate">
          <span className="book-plate-title">{doc.title}</span>
        </span>
      )}
      <span className="book-sheen" aria-hidden />
    </span>
  );
}

type Props = {
  doc: DocMeta;
  now: number;
  binding: boolean;
  lifted: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLLIElement>) => void;
  onCover: (file: File) => void;
};

/** One book on a shelf: its cover, title, and a way to its settings. Drop an image on it for a cover. */
export default function Book(p: Props) {
  const { doc: d } = p;
  const [dropping, setDropping] = useState(false);

  return (
    <li
      data-book={d.id}
      className={`book ${dropping ? "is-drop" : ""} ${p.binding ? "is-binding" : ""} ${p.lifted ? "is-lifted" : ""}`}
      onPointerDown={p.onPointerDown}
      onDragStart={(e) => e.preventDefault()}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={(e) => {
        setDropping(false);
        const file = e.dataTransfer.files[0];
        if (file && isImage(file)) p.onCover(file);
      }}
    >
      <Link href={`/d/${d.id}`} className="book-link" draggable={false}>
        <Cover doc={d} />
        <span className="book-caption">
          <span className="book-title">{d.title}</span>
          <span className="book-meta" title={wordsPagesTitle(d.words)}>
            {wordsPages(d.words)}
          </span>
          {/* A row of its own: beside the counts it wrapped mid-phrase on longer books. */}
          <span className="book-meta" suppressHydrationWarning>
            {ago(d.modified, p.now)}
          </span>
        </span>
      </Link>

      <Link
        href={`/d/${d.id}/settings`}
        className="icon-btn book-gear"
        draggable={false}
        aria-label={`Settings for ${d.title}`}
        title="Book settings"
      >
        <IconGear />
      </Link>
    </li>
  );
}
