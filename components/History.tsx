"use client";

import { useCallback, useEffect, useState } from "react";
import type { VersionMeta } from "@/lib/versions";
import { IconTrash } from "./icons";

function when(ms: number) {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `Today ${time}` : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

function delta(n: number) {
  if (n === 0) return "±0";
  return `${n > 0 ? "+" : "−"}${Math.abs(n).toLocaleString()}`;
}

type Props = {
  docId: string;
  /** Bumped by the parent after a restore so the list refreshes. */
  refreshKey: number;
  previewing: string | null;
  /** Save pending edits before snapshotting. */
  beforeSave: () => Promise<void>;
  onPreview: (v: VersionMeta) => void;
};

export default function History({ docId, refreshKey, previewing, beforeSave, onPreview }: Props) {
  const [list, setList] = useState<VersionMeta[] | null>(null);
  const [label, setLabel] = useState("");
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/docs/${docId}/versions`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setList((await res.json()) as VersionMeta[]);
    } catch {
      setError("Couldn’t load history.");
    }
  }, [docId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await beforeSave();
      const res = await fetch(`/api/docs/${docId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) throw new Error();
      setLabel("");
      setNaming(false);
      await load();
    } catch {
      setError("Couldn’t save the version.");
    }
    setBusy(false);
  };

  const remove = async (vid: string) => {
    setConfirming(null);
    await fetch(`/api/docs/${docId}/versions/${vid}`, { method: "DELETE" });
    await load();
  };

  return (
    <div className="history">
      {naming ? (
        <form className="history-save" onSubmit={save}>
          <input
            autoFocus
            placeholder="Label, e.g. Before rewriting ch. 3"
            value={label}
            maxLength={120}
            onChange={(e) => setLabel(e.target.value)}
            disabled={busy}
          />
          <div className="history-save-actions">
            <button type="button" className="btn btn-quiet" onClick={() => setNaming(false)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="history-new" onClick={() => setNaming(true)}>
          + Save a version
        </button>
      )}

      {error && <p className="outline-empty">{error}</p>}

      {list && list.length === 0 && (
        <p className="outline-empty">
          No versions yet. Save one before a big change; a copy is also kept automatically at the start of each
          writing session.
        </p>
      )}

      {list && list.length > 0 && (
        <ol className="outline-list">
          {list.map((v, i) => {
            const older = list[i + 1];
            return (
              <li key={v.id} className={`library-row ${confirming === v.id ? "is-confirming" : ""}`}>
                {confirming === v.id ? (
                  <div className="library-confirm">
                    <span>Delete this version?</span>
                    <div className="library-confirm-actions">
                      <button type="button" onClick={() => setConfirming(null)}>
                        Keep
                      </button>
                      <button type="button" className="danger" onClick={() => remove(v.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`library-item version-item is-${v.kind} ${previewing === v.id ? "is-active" : ""}`}
                      onClick={() => onPreview(v)}
                    >
                      <span className="library-title">{v.label || "Saved version"}</span>
                      <span className="library-meta" suppressHydrationWarning>
                        {when(v.created)} · {v.words.toLocaleString()} w
                        {older ? ` · ${delta(v.words - older.words)}` : ""}
                      </span>
                    </button>
                    {v.kind === "named" && (
                      <button
                        type="button"
                        className="icon-btn library-delete"
                        aria-label={`Delete version ${v.label}`}
                        title="Delete version"
                        onClick={() => setConfirming(v.id)}
                      >
                        <IconTrash />
                      </button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
