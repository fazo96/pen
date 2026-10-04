"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isImage, prepareNote } from "@/lib/cover";
import type { EntryMeta } from "@/lib/docs";
import { readNdjson } from "@/lib/ndjson";
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

  // Reloaded when the open entry changes too: the one left behind was just saved.
  useEffect(() => {
    void load();
  }, [load, refreshKey, activeId]);

  // Keep the open entry's live title, so a rename shows after switching away
  // without waiting for the reload.
  useEffect(() => {
    if (!activeId || !activeTitle) return;
    setList((l) => l && l.map((e) => (e.id === activeId && e.title !== activeTitle ? { ...e, title: activeTitle } : e)));
  }, [activeId, activeTitle]);

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

  /** POST an entry; its id, or throws with the server's reason. */
  const post = async (body: object) => {
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `request failed (${res.status})`);
    }
    return ((await res.json()) as { id: string }).id;
  };

  /** Photos of a note to transcribe: the entry's id comes at the end of a stream (see the route). */
  const postNote = async (images: string[]) => {
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `request failed (${res.status})`);
    }
    let id: string | null = null;
    let error: string | null = null;
    await readNdjson<{ t: string; id?: string; error?: string }>(res, (line) => {
      if (line.t === "entry" && line.id) id = line.id;
      if (line.t === "error") error = line.error ?? "transcription failed";
    });
    if (error) throw new Error(error);
    if (!id) throw new Error("the answer was cut off");
    return id as string;
  };

  /**
   * Each file becomes an entry, except pictures: together they're the pages of
   * one handwritten note, which Construct's agent transcribes. One entry opens
   * it; several stay put and report back.
   */
  const importFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const imported: string[] = [];
    const skipped: string[] = [];
    // Photo names count up (IMG_0098, IMG_0099…): that's the page order.
    const pictures = files
      .filter(isImage)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const others = files.filter((f) => !isImage(f));
    for (const file of others) {
      const problem = importProblem(file, true);
      if (problem) {
        skipped.push(problem);
        continue;
      }
      try {
        imported.push(
          await post(
            HTML_EXT.test(file.name)
              ? { html: await file.text() }
              : { content: await importText(file), name: file.name.replace(IMPORT_EXT, "") },
          ),
        );
      } catch (e) {
        skipped.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (pictures.length) {
      const what = pictures.length === 1 ? "the picture" : `${pictures.length} pictures`;
      setNotice(`Transcribing ${what}… this can take a minute, longer if a self-hosted model has to load.`);
      try {
        imported.push(await postNote(await Promise.all(pictures.map(prepareNote))));
      } catch (e) {
        skipped.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
      }
      setNotice(null);
    }
    const opening = others.length + (pictures.length ? 1 : 0) === 1 && imported.length === 1;
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
