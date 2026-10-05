import "server-only";
import { mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { createExclusive, writeAtomic } from "../files";
import { isValidId } from "../ids";
import { droppedEntry, renamedEntry } from "../spot";
import { slugify, titleOf, wordCount } from "../text";
import type { Doc, EntryMeta } from "../types";
import { codexDir, entryFile, isMissing, projectExists, ready, serialize, stale, trashPath, versionOf, type WriteResult } from "./core";
import { updateSpots } from "./spots";
import { trackSave } from "./stats";

// Notes that sit beside the manuscript: <project>/codex/<entry>.md.

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
  if (!isValidId(id) || !(await projectExists(id))) return null;
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
  if (!isValidId(id) || !isValidId(eid)) return null;
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
      if (track) trackSave({ book: id, kind: "codex", before: current?.content ?? "", after: content, pasted: track.pasted });
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
      return true;
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  });
}
