"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isImage, prepareNote } from "@/lib/cover";
import type { EntryMeta } from "@/lib/types";
import type { ImportMeta } from "@/lib/imports";
import { useDropZone } from "@/lib/useDropZone";
import { CODEX_IMPORT_ACCEPT, CODEX_NOTE_ACCEPT, HTML_EXT, IMPORT_EXT, importProblem, importText } from "@/lib/useLibrary";
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
  /** Whether pen's AI features are on here: photos of notes need them. */
  ai?: boolean;
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
export default function Codex({ projectId, activeId, activeTitle, onOpen, refreshKey = 0, ai = false }: Props) {
  const [list, setList] = useState<EntryMeta[] | null>(null);
  /** Notes being transcribed, and ones that failed (until dismissed on their page). */
  const [imports, setImports] = useState<ImportMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const base = `/api/docs/${projectId}/codex`;

  const load = useCallback(async () => {
    try {
      const [res, jobs] = await Promise.all([
        fetch(base, { cache: "no-store" }),
        fetch(`/api/docs/${projectId}/imports`, { cache: "no-store" }).catch(() => null),
      ]);
      if (!res.ok) throw new Error();
      setList((await res.json()) as EntryMeta[]);
      if (jobs?.ok) setImports(((await jobs.json()) as ImportMeta[]).filter((j) => j.status !== "done"));
    } catch {
      setError("Couldn’t load the codex.");
    }
  }, [base, projectId]);

  // Reloaded when the open entry changes too: the one left behind was just saved.
  useEffect(() => {
    void load();
  }, [load, refreshKey, activeId]);

  // While a note is being transcribed, look again every few seconds: its entry shows up when it's done.
  const running = imports.some((j) => j.status === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [running, load]);

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

  /** Photos of a note to transcribe: the import's id (its page follows it, see the route). */
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
    return ((await res.json()) as { job: string }).job;
  };

  /**
   * Each file becomes an entry, except pictures: together they're the pages of
   * one handwritten note, which Construct's agent transcribes on a page of its
   * own, opened once they're sent. Otherwise one entry opens it; several stay
   * put and report back.
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
    if (!ai && pictures.length) {
      skipped.push(`${pictures.map((p) => p.name).join(", ")}: transcribing notes needs AI, which is off (see Settings)`);
      pictures.length = 0;
    }
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
    let job: string | null = null;
    if (pictures.length) {
      const what = pictures.length === 1 ? "the picture" : `${pictures.length} pictures`;
      setNotice(`Sending ${what}…`);
      try {
        job = await postNote(await Promise.all(pictures.map(prepareNote)));
      } catch (e) {
        skipped.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
      }
      setNotice(null);
    }
    if (job) {
      setBusy(false);
      if (skipped.length) setError(`Skipped ${skipped.join("; ")}.`);
      return onOpen(`/d/${projectId}/import/${job}`);
    }
    const opening = others.length === 1 && imported.length === 1;
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
    setError(null);
    try {
      const res = await fetch(`${base}/${eid}`, { method: "DELETE" });
      // 404: already gone (deleted elsewhere), which is what was asked.
      if (!res.ok && res.status !== 404) throw new Error();
    } catch {
      setError("Couldn’t delete the entry.");
      await load();
      return;
    }
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
        accept={ai ? CODEX_NOTE_ACCEPT : CODEX_IMPORT_ACCEPT}
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

      {imports.length > 0 && (
        <ul className="outline-list">
          {imports.map((j) => (
            <li key={j.id} className="library-row">
              <button
                type="button"
                className={`library-item version-item codex-import is-${j.status}`}
                onClick={() => onOpen(`/d/${projectId}/import/${j.id}`)}
              >
                <span className="library-title">
                  {j.status === "running" && <span className="codex-import-dot" aria-hidden />}
                  {j.status === "running" ? "Transcribing" : j.error === "stopped" ? "Stopped transcribing" : "Couldn’t transcribe"}{" "}
                  {j.pages === 1 ? "a picture" : `${j.pages} pictures`}
                  {j.status === "running" ? "…" : ""}
                </span>
                <span className="library-meta">{j.status === "running" ? "in progress" : j.error === "stopped" ? "stopped" : "failed"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {list && list.length === 0 && imports.length === 0 && (
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
