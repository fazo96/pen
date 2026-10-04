"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiDelete, saveVersion } from "@/lib/api";
import { useDropZone } from "@/lib/useDropZone";
import { IMPORT_ACCEPT, IMPORT_EXT, importProblem } from "@/lib/useLibrary";
import type { VersionMeta } from "@/lib/types";
import { wordsPages, wordsPagesTitle } from "@/lib/text";
import ConfirmRow from "./ConfirmRow";
import { IconPencil, IconTrash } from "./icons";

function when(ms: number) {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  // Imported drafts can be years old: say which year.
  const year = d.getFullYear() === new Date().getFullYear() ? undefined : "numeric";
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year })} ${time}`;
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
  /** A version was relabelled (the preview may be showing it). */
  onRenamed: (v: VersionMeta) => void;
};

export default function History({ docId, refreshKey, previewing, beforeSave, onPreview, onRenamed }: Props) {
  const [list, setList] = useState<VersionMeta[] | null>(null);
  const [label, setLabel] = useState("");
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setList(await api<VersionMeta[]>(`/api/docs/${docId}/versions`));
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
      await saveVersion(docId, label);
      setLabel("");
      setNaming(false);
      await load();
    } catch {
      setError("Couldn’t save the version.");
    }
    setBusy(false);
  };

  /**
   * Older drafts kept elsewhere become named versions, placed in the timeline
   * by the file's own date. The manuscript isn't touched; one file opens its
   * preview, from where it can be restored.
   */
  const importFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const imported: VersionMeta[] = [];
    const skipped: string[] = [];
    for (const file of files) {
      const problem = importProblem(file);
      if (problem) {
        skipped.push(problem);
        continue;
      }
      try {
        const meta = await api<VersionMeta>(`/api/docs/${docId}/versions`, {
          method: "POST",
          json: {
            content: (await file.text()).replace(/^\uFEFF/, ""),
            label: file.name.replace(IMPORT_EXT, ""),
            created: file.lastModified,
          },
        });
        imported.push(meta);
      } catch (e) {
        skipped.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await load();
    setBusy(false);
    if (imported.length) setNotice(`Imported ${imported.length} ${imported.length === 1 ? "version" : "versions"}.`);
    if (skipped.length) setError(`Skipped ${skipped.join("; ")}.`);
    if (files.length === 1 && imported.length === 1) onPreview(imported[0]);
  };
  const drop = useDropZone((files) => {
    if (!busy) void importFiles(files);
  });

  /** Relabel a version; an automatic one becomes named, so it's kept. */
  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renaming) return;
    setBusy(true);
    setError(null);
    try {
      onRenamed(
        await api<VersionMeta>(`/api/docs/${docId}/versions/${renaming.id}`, { method: "PATCH", json: { label: renaming.label } }),
      );
      setRenaming(null);
      await load();
    } catch {
      setError("Couldn’t rename the version.");
    }
    setBusy(false);
  };

  const remove = async (vid: string) => {
    setConfirming(null);
    setError(null);
    try {
      await apiDelete(`/api/docs/${docId}/versions/${vid}`);
    } catch {
      setError("Couldn’t delete the version.");
    }
    await load();
  };

  return (
    <div className={`history drop-panel ${drop.dropping ? "is-drop" : ""}`} {...drop.props}>
      {drop.dropping && (
        <p className="drop-hint" aria-hidden>
          Drop to add to History
        </p>
      )}
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
        <div className="panel-actions">
          <button type="button" className="history-new" onClick={() => setNaming(true)} disabled={busy}>
            + Save a version
          </button>
          <button type="button" className="history-new" onClick={() => picker.current?.click()} disabled={busy}>
            Import…
          </button>
        </div>
      )}
      <input
        ref={picker}
        type="file"
        accept={IMPORT_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          void importFiles(files);
        }}
      />

      {notice && (
        <p className="outline-empty panel-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="outline-empty" role="alert">
          {error}
        </p>
      )}

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
              <li key={v.id} className="library-row">
                {renaming?.id === v.id ? (
                  <form className="history-save" onSubmit={rename}>
                    <input
                      autoFocus
                      aria-label="Version name"
                      onFocus={(e) => e.currentTarget.select()}
                      placeholder="Saved version"
                      value={renaming.label}
                      maxLength={120}
                      onChange={(e) => setRenaming({ id: v.id, label: e.target.value })}
                      onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                      disabled={busy}
                    />
                    <div className="history-save-actions">
                      <button type="button" className="btn btn-quiet" onClick={() => setRenaming(null)} disabled={busy}>
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-primary" disabled={busy}>
                        {busy ? "Saving…" : "Rename"}
                      </button>
                    </div>
                  </form>
                ) : confirming === v.id ? (
                  <ConfirmRow onKeep={() => setConfirming(null)} onConfirm={() => remove(v.id)}>
                    Delete this version?
                  </ConfirmRow>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`library-item version-item is-${v.kind} ${previewing === v.id ? "is-active" : ""}`}
                      onClick={() => onPreview(v)}
                    >
                      <span className="library-title">{v.label || "Saved version"}</span>
                      <span className="library-meta" title={wordsPagesTitle(v.words)} suppressHydrationWarning>
                        {when(v.created)} · {wordsPages(v.words)}
                        {older ? ` · ${delta(v.words - older.words)}` : ""}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn library-delete library-rename"
                      aria-label={`Rename version ${v.label || "Saved version"}`}
                      title="Rename version"
                      onClick={() => {
                        setConfirming(null);
                        setRenaming({ id: v.id, label: v.label });
                      }}
                    >
                      <IconPencil />
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
