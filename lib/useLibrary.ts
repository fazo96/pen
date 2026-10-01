"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { isImage, prepareCover } from "./cover";
import { newManuscript, withTitle } from "./text";

const MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_ACCEPT = ".md,.markdown,.mdown,.txt,text/markdown,text/plain";
export const IMPORT_EXT = /\.(md|markdown|mdown|txt)$/i;
/** The Codex also takes saved Critique Circle pages, converted by the server. */
export const CODEX_IMPORT_ACCEPT = `${IMPORT_ACCEPT},.html,.htm,text/html`;
export const HTML_EXT = /\.html?$/i;

/** Why a file can't be imported (manuscript or Codex), or null if it can. */
export function importProblem(file: File, codex = false): string | null {
  if (codex && HTML_EXT.test(file.name)) {
    if (file.size > MAX_BYTES) return `${file.name} is larger than 5 MB`;
    return null;
  }
  if (!IMPORT_EXT.test(file.name)) {
    return `${file.name} isn't a markdown or text file${codex ? " or a saved Critique Circle page" : ""}`;
  }
  if (file.size > MAX_BYTES) return `${file.name} is larger than 5 MB`;
  return null;
}

/** A file's text, ready to import: an H1 title is added from its name if it has none. */
export async function importText(file: File): Promise<string> {
  return withTitle(await file.text(), file.name);
}

async function fail(res: Response): Promise<never> {
  const body = await res.json().catch(() => ({}));
  throw new Error((body as { error?: string }).error ?? `request failed (${res.status})`);
}

/** Move a project's localStorage backups (manuscript and Codex entries) to its new id. */
function moveBackups(from: string, to: string) {
  try {
    const prefix = `pen:backup:${from}`;
    for (const key of Object.keys(localStorage)) {
      if (key !== prefix && !key.startsWith(`${prefix}/`)) continue;
      const value = localStorage.getItem(key);
      if (value !== null) localStorage.setItem(`pen:backup:${to}${key.slice(prefix.length)}`, value);
      localStorage.removeItem(key);
    }
  } catch {}
}

/** Create, import and delete documents and set their covers, then navigate or refresh. */
export function useLibrary() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const create = useCallback(
    (content: string, name?: string) =>
      run(async () => {
        const res = await fetch("/api/docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, name }),
        });
        if (!res.ok) await fail(res);
        const doc = (await res.json()) as { id: string };
        router.push(`/d/${doc.id}`);
      }),
    [router, run],
  );

  /** A blank manuscript under `title`, which also names its address. */
  const createNew = useCallback((title: string) => create(newManuscript(title), title.trim() || "untitled"), [create]);

  const importFile = useCallback(
    async (file: File) => {
      const problem = importProblem(file);
      if (problem) {
        setError(problem);
        return;
      }
      await create(await importText(file), file.name.replace(IMPORT_EXT, ""));
    },
    [create],
  );

  /** Trash a document, then go to `next` (or stay and refresh). */
  const remove = useCallback(
    (id: string, next?: string) =>
      run(async () => {
        const res = await fetch(`/api/docs/${id}`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) await fail(res);
        try {
          localStorage.removeItem(`pen:backup:${id}`);
        } catch {}
        if (next) router.push(next);
        else router.refresh();
      }),
    [router, run],
  );

  /** Give a document a new id; its local backups follow. True once done. */
  const rename = useCallback(
    async (id: string, to: string) => {
      let done = false;
      await run(async () => {
        const res = await fetch(`/api/docs/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: to }),
        });
        if (!res.ok) await fail(res);
        moveBackups(id, to);
        done = true;
      });
      return done;
    },
    [run],
  );

  const setCover = useCallback(
    (id: string, file: File) =>
      run(async () => {
        if (!isImage(file)) throw new Error(`${file.name} isn't an image`);
        const res = await fetch(`/api/docs/${id}/cover`, { method: "PUT", body: await prepareCover(file) });
        if (!res.ok) await fail(res);
        router.refresh();
      }),
    [router, run],
  );

  const removeCover = useCallback(
    (id: string) =>
      run(async () => {
        const res = await fetch(`/api/docs/${id}/cover`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) await fail(res);
        router.refresh();
      }),
    [router, run],
  );

  return { busy, error, clearError: () => setError(null), createNew, importFile, remove, rename, setCover, removeCover };
}
