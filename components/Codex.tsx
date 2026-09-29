"use client";

import { useCallback, useEffect, useState } from "react";
import type { EntryMeta } from "@/lib/docs";
import { IconTrash } from "./icons";

type Props = {
  projectId: string;
  /** The entry open in the editor, if any, and its live title. */
  activeId: string | null;
  activeTitle?: string;
  /** Navigate (saving the current file first). */
  onOpen: (href: string) => void;
  /** Bump to reload the list (e.g. after Construct changed it). */
  refreshKey?: number;
};

/** Plot outlines, character notes and the like: one markdown file each. */
export default function Codex({ projectId, activeId, activeTitle, onOpen, refreshKey = 0 }: Props) {
  const [list, setList] = useState<EntryMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const base = `/api/docs/${projectId}/codex`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setList((await res.json()) as EntryMeta[]);
    } catch {
      setError("Couldn’t load the codex.");
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "# Untitled entry\n\n", name: "entry" }),
      });
      if (!res.ok) throw new Error();
      const entry = (await res.json()) as { id: string };
      onOpen(`/d/${projectId}/codex/${entry.id}`);
    } catch {
      setError("Couldn’t create the entry.");
      setBusy(false);
    }
  };

  const remove = async (eid: string) => {
    setConfirming(null);
    await fetch(`${base}/${eid}`, { method: "DELETE" });
    try {
      localStorage.removeItem(`pen:backup:${projectId}/codex/${eid}`);
    } catch {}
    if (eid === activeId) onOpen(`/d/${projectId}`);
    else await load();
  };

  return (
    <div className="codex">
      <button type="button" className="history-new" onClick={create} disabled={busy}>
        + New entry
      </button>

      {error && <p className="outline-empty">{error}</p>}

      {list && list.length === 0 && (
        <p className="outline-empty">
          Nothing here yet. Keep plot outlines, character notes, places and rules of the world beside the manuscript.
        </p>
      )}

      {list && list.length > 0 && (
        <ul className="outline-list">
          {list.map((e) => (
            <li key={e.id} className={`library-row ${confirming === e.id ? "is-confirming" : ""}`}>
              {confirming === e.id ? (
                <div className="library-confirm">
                  <span>
                    Delete <em>{e.title}</em>?
                  </span>
                  <div className="library-confirm-actions">
                    <button type="button" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                    <button type="button" className="danger" onClick={() => remove(e.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className={`library-item version-item ${e.id === activeId ? "is-active" : ""}`}
                    onClick={() => e.id !== activeId && onOpen(`/d/${projectId}/codex/${e.id}`)}
                  >
                    <span className="library-title">{(e.id === activeId && activeTitle) || e.title}</span>
                    <span className="library-meta">{e.words.toLocaleString()} w</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn library-delete"
                    aria-label={`Delete ${e.title}`}
                    title="Delete entry"
                    onClick={() => setConfirming(e.id)}
                  >
                    <IconTrash />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
