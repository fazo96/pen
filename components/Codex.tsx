"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiDelete, createEntry } from "@/lib/api";
import { isImage, prepareNote } from "@/lib/cover";
import { codexHome, entryBackupKey, entryHref, type EntryRef, entryOfRef } from "@/lib/entryRef";
import { GLOBAL } from "@/lib/ids";
import type { EntryMeta } from "@/lib/types";
import type { ImportMeta } from "@/lib/imports";
import { useDropZone } from "@/lib/useDropZone";
import { local } from "@/lib/storage";
import { CODEX_IMPORT_ACCEPT, CODEX_NOTE_ACCEPT, HTML_EXT, IMPORT_EXT, importProblem, importText } from "@/lib/useLibrary";
import ConfirmRow from "./ConfirmRow";
import { IconMove, IconTrash } from "./icons";

type Props = {
  /** The book, or GLOBAL on the Global Codex's own page. */
  projectId: string;
  /** The entry open in the editor, if any (a ref, see lib/entryRef.ts), and its live title. */
  activeId: string | null;
  activeTitle?: string;
  /** Navigate (saving the current file first). */
  onOpen: (href: string) => void | Promise<void>;
  /** Move an entry between the book's Codex and the Global Codex (`to`); offered in a book. */
  onMove?: (from: EntryRef, to: string) => Promise<void>;
  /** Bump to reload the list (e.g. after Construct changed it). */
  refreshKey?: number;
  /** Whether pen's AI features are on here: photos of notes need them. */
  ai?: boolean;
};

/**
 * Plot outlines, character notes and the like: one markdown file each. In a
 * book, the Global Codex's entries (the notes every book shares) follow.
 */
export default function Codex({ projectId, activeId, activeTitle, onOpen, onMove, refreshKey = 0, ai = false }: Props) {
  const isGlobal = projectId === GLOBAL;
  const active = activeId ? entryOfRef(projectId, activeId) : null;
  const [list, setList] = useState<EntryMeta[] | null>(null);
  /** In a book: the Global Codex's entries. */
  const [shared, setShared] = useState<EntryMeta[] | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
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
      const [entries, jobs, global] = await Promise.all([
        api<EntryMeta[]>(base),
        api<ImportMeta[]>(`/api/docs/${projectId}/imports`).catch(() => null),
        isGlobal ? null : api<EntryMeta[]>(`/api/docs/${GLOBAL}/codex`).catch(() => null),
      ]);
      setList(entries);
      if (jobs) setImports(jobs.filter((j) => j.status !== "done"));
      if (global) setShared(global);
    } catch {
      setError("Couldn’t load the codex.");
    }
  }, [base, projectId, isGlobal]);

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
  const activeOwner = active?.owner;
  const activeEid = active?.id;
  useEffect(() => {
    if (!activeEid || !activeTitle) return;
    const retitle = (l: EntryMeta[] | null) =>
      l ? l.map((e) => (e.id === activeEid && e.title !== activeTitle ? { ...e, title: activeTitle } : e)) : l;
    if (activeOwner === projectId) setList(retitle);
    else setShared(retitle);
  }, [activeOwner, activeEid, activeTitle, projectId]);

  const create = async (owner = projectId) => {
    setBusy(true);
    setError(null);
    try {
      // Wide screens open it beside the manuscript, keeping this list on screen.
      await onOpen(entryHref(owner, await createEntry(owner)));
      await load();
    } catch {
      setError("Couldn’t create the entry.");
    }
    setBusy(false);
  };

  const move = async (from: EntryRef) => {
    if (!onMove) return;
    setMoving(`${from.owner}/${from.id}`);
    setError(null);
    try {
      await onMove(from, from.owner === GLOBAL ? projectId : GLOBAL);
    } catch {
      setError("Couldn’t move the entry.");
    }
    await load();
    setMoving(null);
  };

  /** POST an entry; its id, or throws with the server's reason. */
  const post = async (body: object) => (await api<{ id: string }>(base, { method: "POST", json: body })).id;

  /** Photos of a note to transcribe: the import's id (its page follows it, see the route). */
  const postNote = async (images: string[]) => (await api<{ job: string }>(base, { method: "POST", json: { images } })).job;

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
    if (opening) await onOpen(entryHref(projectId, imported[0]));
    await load();
    setBusy(false);
    if (imported.length && !opening) setNotice(`Imported ${imported.length} ${imported.length === 1 ? "entry" : "entries"}.`);
    if (skipped.length) setError(`Skipped ${skipped.join("; ")}.`);
  };
  const drop = useDropZone((files) => {
    if (!busy) void importFiles(files);
  });

  const remove = async (target: EntryRef) => {
    setConfirming(null);
    setError(null);
    try {
      await apiDelete(`/api/docs/${target.owner}/codex/${target.id}`);
    } catch {
      setError("Couldn’t delete the entry.");
      await load();
      return;
    }
    local.set(entryBackupKey(target.owner, target.id), null);
    // The open one: back to where its list lives (in a book, that closes the panel).
    if (target.owner === active?.owner && target.id === active.id) onOpen(codexHome(projectId));
    else await load();
  };

  /** One Codex's entries: the book's (or the Global Codex's on its own page), or the Global Codex's in a book. */
  const rows = (owner: string, entries: EntryMeta[]) => (
    <ul className="outline-list">
      {entries.map((e) => {
        const key = `${owner}/${e.id}`;
        const isActive = active?.owner === owner && active.id === e.id;
        const where = owner === GLOBAL ? "this book" : "the Global Codex";
        return (
          <li key={key} className="library-row">
            {confirming === key ? (
              <ConfirmRow onKeep={() => setConfirming(null)} onConfirm={() => remove({ owner, id: e.id })}>
                Delete <em>{e.title}</em>?
              </ConfirmRow>
            ) : (
              <>
                <button
                  type="button"
                  className={`library-item version-item ${isActive ? "is-active" : ""}`}
                  onClick={() => !isActive && onOpen(entryHref(owner, e.id))}
                >
                  <span className="library-title">{(isActive && activeTitle) || e.title}</span>
                  <span className="library-meta">{e.words.toLocaleString()} w</span>
                </button>
                {onMove && !isGlobal && (
                  <button
                    type="button"
                    className="icon-btn library-delete library-move"
                    aria-label={`Move ${e.title} to ${where}`}
                    title={`Move to ${where}`}
                    disabled={moving !== null}
                    onClick={() => void move({ owner, id: e.id })}
                  >
                    <IconMove />
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn library-delete"
                  aria-label={`Delete ${e.title}`}
                  title="Delete entry"
                  onClick={() => setConfirming(key)}
                >
                  <IconTrash />
                </button>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className={`codex drop-panel ${drop.dropping ? "is-drop" : ""}`} {...drop.props}>
      {drop.dropping && (
        <p className="drop-hint" aria-hidden>
          Drop to add to the {isGlobal ? "Global " : ""}Codex
        </p>
      )}
      <div className="panel-actions">
        <button type="button" className="history-new" onClick={() => void create()} disabled={busy}>
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
          {isGlobal
            ? "Nothing here yet. Keep what every book shares: a style sheet, a world several books live in, research, ideas waiting for a book."
            : "Nothing here yet. Keep plot outlines, character notes, places and rules of the world beside the manuscript."}
        </p>
      )}

      {list && list.length > 0 && rows(projectId, list)}

      {shared && (
        <section className="codex-global" aria-label="Global Codex">
          <div className="codex-global-head">
            <span className="label">Global Codex</span>
            <button type="button" className="history-new" onClick={() => void create(GLOBAL)} disabled={busy}>
              + New
            </button>
          </div>
          {shared.length > 0 ? (
            rows(GLOBAL, shared)
          ) : (
            <p className="outline-empty">Notes every book shares. Move an entry here to reach it from every book.</p>
          )}
        </section>
      )}
    </div>
  );
}
