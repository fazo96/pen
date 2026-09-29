"use client";

import Link from "next/link";
import { useState } from "react";
import type { DocMeta } from "@/lib/docs";
import { IconTrash } from "./icons";

function ago(ms: number, now: number) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

type Props = {
  docs: DocMeta[];
  onDelete: (id: string) => void;
  busy: boolean;
};

export default function Library({ docs, onDelete, busy }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const now = Date.now();

  if (docs.length === 0) {
    return <p className="outline-empty">No manuscripts yet.</p>;
  }

  return (
    <ul className="outline-list library">
      {docs.map((d) => (
        <li key={d.id} className={`library-row ${confirming === d.id ? "is-confirming" : ""}`}>
          {confirming === d.id ? (
            <div className="library-confirm">
              <span>
                Move <em>{d.title}</em> to trash?
              </span>
              <div className="library-confirm-actions">
                <button type="button" onClick={() => setConfirming(null)}>
                  Keep
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(null);
                    onDelete(d.id);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <>
              <Link href={`/d/${d.id}`} className="library-item">
                <span className="library-title">{d.title}</span>
                <span className="library-meta" suppressHydrationWarning>
                  {d.words.toLocaleString()} w · {ago(d.modified, now)}
                </span>
              </Link>
              <button
                type="button"
                className="icon-btn library-delete"
                aria-label={`Delete ${d.title}`}
                title="Delete"
                onClick={() => setConfirming(d.id)}
              >
                <IconTrash />
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
