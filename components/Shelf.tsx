"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { COVER_ACCEPT, isImage } from "@/lib/cover";
import type { DocMeta } from "@/lib/docs";
import { IconClose, IconImage, IconMore, IconTrash } from "./icons";

function ago(ms: number, now: number) {
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

type Props = {
  docs: DocMeta[];
  busy: boolean;
  onDelete: (id: string) => void;
  onCover: (id: string, file: File) => Promise<void>;
  onRemoveCover: (id: string) => void;
};

/** The library as a shelf of books, each with its cover. */
export default function Shelf({ docs, busy, onDelete, onCover, onRemoveCover }: Props) {
  const [menu, setMenu] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [binding, setBinding] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const pickFor = useRef<string | null>(null);
  const now = Date.now();

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element).closest(".book-menu, .book-more")) {
        setMenu(null);
        setConfirming(null);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  const cover = async (id: string, file: File) => {
    setBinding(id);
    try {
      await onCover(id, file);
    } finally {
      setBinding(null);
    }
  };

  return (
    <>
      <ul className="shelf">
        {docs.map((d) => (
          <li
            key={d.id}
            className={`book ${dropTarget === d.id ? "is-drop" : ""} ${binding === d.id ? "is-binding" : ""}`}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              setDropTarget(d.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null);
            }}
            onDrop={(e) => {
              setDropTarget(null);
              const file = e.dataTransfer.files[0];
              if (file && isImage(file)) void cover(d.id, file);
            }}
          >
            <Link href={`/d/${d.id}`} className="book-link">
              <span className="book-cover" style={{ "--cloth": clothOf(d.id) } as React.CSSProperties}>
                {d.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element -- served by our own route, already sized
                  <img src={`/api/docs/${d.id}/cover?v=${Math.round(d.cover)}`} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span className="book-plate">
                    <span className="book-plate-title">{d.title}</span>
                  </span>
                )}
                <span className="book-sheen" aria-hidden />
              </span>
              <span className="book-caption">
                <span className="book-title">{d.title}</span>
                <span className="book-meta" suppressHydrationWarning>
                  {d.words.toLocaleString()} w · {ago(d.modified, now)}
                </span>
              </span>
            </Link>

            <button
              type="button"
              className="icon-btn book-more"
              aria-label={`Options for ${d.title}`}
              aria-expanded={menu === d.id}
              onClick={() => {
                setConfirming(null);
                setMenu((m) => (m === d.id ? null : d.id));
              }}
            >
              <IconMore />
            </button>

            {menu === d.id && (
              <div className="book-menu" role="menu">
                {confirming === d.id ? (
                  <div className="book-confirm">
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
                          setMenu(null);
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
                    <button
                      type="button"
                      role="menuitem"
                      disabled={busy}
                      onClick={() => {
                        setMenu(null);
                        pickFor.current = d.id;
                        picker.current?.click();
                      }}
                    >
                      <IconImage /> {d.cover ? "Change cover…" : "Set cover…"}
                    </button>
                    {d.cover && (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={busy}
                        onClick={() => {
                          setMenu(null);
                          onRemoveCover(d.id);
                        }}
                      >
                        <IconClose /> Remove cover
                      </button>
                    )}
                    <button type="button" role="menuitem" className="danger" onClick={() => setConfirming(d.id)}>
                      <IconTrash /> Delete…
                    </button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      <input
        ref={picker}
        type="file"
        accept={COVER_ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file && pickFor.current) void cover(pickFor.current, file);
        }}
      />
    </>
  );
}
