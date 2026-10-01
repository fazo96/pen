"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EntryMeta } from "@/lib/docs";
import { useDropZone } from "@/lib/useDropZone";
import { CODEX_IMPORT_ACCEPT, HTML_EXT, IMPORT_EXT, importProblem, importText } from "@/lib/useLibrary";
import { IconTrash } from "./icons";

type Props = {
  projectId: string;
  /** The entry open in the editor, if any, and its live title. */
  activeId: string | null;
  activeTitle?: string;
  /** Navigate (saving the current file first). */
  onOpen: (href: string) => void | Promise<void>;
  /** Bump to reload the list (e.g. after Construct changed it). */
  refreshKey?: number;
};

/** A new, untitled entry (from here or the command palette); its id. */
export async function createEntry(projectId: string): Promise<string> {
  const res = await fetch(`/api/docs/${projectId}/codex`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "# Untitled entry\n\n", name: "entry" }),
  });
  if (!res.ok) throw new Error();
  return ((await res.json()) as { id: string }).id;
}

/** Plot outlines, character notes and the like: one markdown file each. */
export default function Codex({ projectId, activeId, activeTitle, onOpen, refreshKey = 0 }: Props) {
  const [list, setList] = useState<EntryMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
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
      // Wide screens open it beside the manuscript, keeping this list on screen.
      await onOpen(`/d/${projectId}/codex/${await createEntry(projectId)}`);
      await load();
    } catch {
      setError("Couldn’t create the entry.");
    }
    setBusy(false);
  };

  /** Each file becomes an entry. One file opens it; several stay put and report back. */
  const importFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const imported: string[] = [];
    const skipped: string[] = [];
    for (const file of files) {
      const problem = importProblem(file, true);
      if (problem) {
        skipped.push(problem);
        continue;
      }
      try {
        const res = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            HTML_EXT.test(file.name)
              ? { html: await file.text() }
              : { content: await importText(file), name: file.name.replace(IMPORT_EXT, "") },
          ),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `request failed (${res.status})`);
        }
        imported.push(((await res.json()) as { id: string }).id);
      } catch (e) {
        skipped.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const opening = files.length === 1 && imported.length === 1;
    if (opening) await onOpen(`/d/${projectId}/codex/${imported[0]}`);
    await load();
    setBusy(false);
    if (imported.length && !opening) setNotice(`Imported ${imported.length} ${imported.length === 1 ? "entry" : "entries"}.`);
    if (skipped.length) setError(`Skipped ${skipped.join("; ")}.`);
  };
  const drop = useDropZone((files) => {
    if (!busy) void importFiles(files);
  });

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
    <div className={`codex drop-panel ${drop.dropping ? "is-drop" : ""}`} {...drop.props}>
      {drop.dropping && (
        <p className="drop-hint" aria-hidden>
          Drop to add to the Codex
        </p>
      )}
      <div className="panel-actions">
        <button type="button" className="history-new" onClick={create} disabled={busy}>
          + New entry
        </button>
        <button type="button" className="history-new" onClick={() => picker.current?.click()} disabled={busy}>
          Import…
        </button>
      </div>
      <input
        ref={picker}
        type="file"
        accept={CODEX_IMPORT_ACCEPT}
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
