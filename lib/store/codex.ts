import "server-only";
import { mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { createExclusive, writeAtomic } from "../files";
import { GLOBAL, isOwnerId, isValidId } from "../ids";
import { droppedEntry, renamedEntry } from "../spot";
import { slugify, titleOf, wordCount } from "../text";
import type { Doc, EntryMeta } from "../types";
import { codexDir, entryFile, isMissing, projectExists, ready, serialize, stale, trashPath, versionOf, type WriteResult } from "./core";
import { updateSpots } from "./spots";
import { recordEntryRename, trackSave } from "./stats";

// Notes that sit beside the manuscript: <project>/codex/<entry>.md. The same
// functions keep the Global Codex, the notes every book shares, with GLOBAL
// as the project. Its entries have no writing stats: those belong to a book.

/** When a Codex entry was last written; 0 without any. */
export async function lastCodexEdit(id: string): Promise<number> {
  let names: string[];
  try {
    names = await readdir(codexDir(id));
  } catch (err) {
    if (isMissing(err)) return 0;
    throw err;
  }
  const times = await Promise.all(
    names
      .filter((n) => n.endsWith(".md"))
      .map((n) =>
        stat(path.join(codexDir(id), n)).then(
          (s) => s.mtimeMs,
          () => 0, // deleted meanwhile
        ),
      ),
  );
  return Math.max(0, ...times);
}

/** Entries in alphabetical order of title; null if the project doesn't exist. */
export async function listCodex(id: string): Promise<EntryMeta[] | null> {
  if (!isOwnerId(id) || !(await projectExists(id))) return null;
  let names: string[];
  try {
    names = await readdir(codexDir(id));
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  const entries = await Promise.all(
    names
      .filter((n) => n.endsWith(".md") && isValidId(n.slice(0, -3)))
      .map(async (n): Promise<EntryMeta | null> => {
        const eid = n.slice(0, -3);
        try {
          const file = entryFile(id, eid);
          const [content, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
          return { id: eid, title: titleOf(content, eid), words: wordCount(content), modified: info.mtimeMs };
        } catch (err) {
          if (isMissing(err)) return null;
          throw err;
        }
      }),
  );
  return entries
    .filter((e): e is EntryMeta => e !== null)
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

export async function readEntry(id: string, eid: string): Promise<Doc | null> {
  if (!isOwnerId(id) || !isValidId(eid)) return null;
  await ready();
  try {
    const content = await readFile(entryFile(id, eid), "utf8");
    return { id: eid, content, version: versionOf(content) };
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

/** Create an entry named after `name` (or its H1). Null if the project doesn't exist. */
export function createEntry(id: string, content: string, name?: string): Promise<Doc | null> {
  return serialize(async () => {
    if (!(await projectExists(id))) return null;
    await mkdir(codexDir(id), { recursive: true });
    const base = slugify(name || titleOf(content, "")) || "entry";
    for (let i = 1; ; i++) {
      const eid = `${base.slice(0, 72)}${i > 1 ? `-${i}` : ""}`;
      if (await createExclusive(entryFile(id, eid), content)) return { id: eid, content, version: versionOf(content) };
    }
  });
}

/** Same contract as writeDoc, for a codex entry (no automatic versions). */
export function writeEntry(
  id: string,
  eid: string,
  content: string,
  baseVersion: string | null,
  force = false,
  track?: { pasted: number },
): Promise<WriteResult> {
  return serialize(async () => {
    const current = await readEntry(id, eid);
    if (stale(current, content, baseVersion, force)) return { ok: false, current: current! };
    if (current?.content !== content) {
      await writeAtomic(entryFile(id, eid), content);
      if (track && id !== GLOBAL) {
        const title = titleOf(content, eid);
        trackSave({ book: id, kind: "codex", entry: eid, before: current?.content ?? "", after: content, pasted: track.pasted, title });
      }
    }
    return { ok: true, version: versionOf(content) };
  });
}

export function trashEntry(id: string, eid: string): Promise<boolean> {
  return serialize(async () => {
    try {
      await rename(entryFile(id, eid), await trashPath(`${id}--codex--${eid}`, ".md"));
      await updateSpots(id, (s) => droppedEntry(s, eid));
      return true;
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  });
}

/** Give an entry a new id (its file name). False if missing or the new id is taken. */
export function renameEntry(id: string, eid: string, newEid: string): Promise<boolean> {
  return serialize(async () => {
    const from = entryFile(id, eid);
    const to = entryFile(id, newEid);
    try {
      await stat(to);
      return false;
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
    try {
      await rename(from, to);
      await updateSpots(id, (s) => renamedEntry(s, eid, newEid));
      if (id !== GLOBAL) await recordEntryRename(id, eid, newEid); // so its writing stats follow it
      return true;
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  });
}

/**
 * Move an entry to another book's Codex or the Global Codex (`to`), keeping its
 * id unless that's taken there (then -2, -3…). Its new id; null if the entry or
 * the destination is missing. Writing stats stay with the book it was written in.
 */
export function moveEntry(id: string, eid: string, to: string): Promise<string | null> {
  if (!isOwnerId(id) || !isOwnerId(to) || !isValidId(eid) || id === to) return Promise.resolve(null);
  return serialize(async () => {
    if (!(await projectExists(to))) return null;
    const from = entryFile(id, eid);
    try {
      await stat(from);
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
    await mkdir(codexDir(to), { recursive: true });
    for (let i = 1; ; i++) {
      const target = i === 1 ? eid : `${eid.slice(0, 72)}-${i}`;
      try {
        await stat(entryFile(to, target));
        continue; // taken
      } catch (err) {
        if (!isMissing(err)) throw err;
      }
      await rename(from, entryFile(to, target));
      await updateSpots(id, (s) => droppedEntry(s, eid));
      return target;
    }
  });
}
