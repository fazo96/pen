import "server-only";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import { writeAtomic } from "../files";
import { isValidId } from "../ids";
import { DOCS_DIR } from "../paths";
import { recordRename } from "../renames";
import { slugify, titleOf, wordCount } from "../text";
import type { Doc, DocMeta } from "../types";
import * as versions from "../versions";
import { pinAgentHome } from "./chats";
import { lastCodexEdit } from "./codex";
import { chatsDir, dirOf, fileOf, isMissing, projectExists, readDoc, ready, serialize, stale, trashPath, versionOf, type WriteResult } from "./core";
import { findCover } from "./cover";
import type { Pastes } from "../writingStats";
import { trackSave } from "./stats";

// Projects as a whole: listing, creating, saving the manuscript, trashing and renaming.

// The first save after this much quiet snapshots the text as it was before.
const SESSION_GAP_MS = Number(process.env.PEN_SESSION_GAP_MS) || 30 * 60 * 1000;

/** Every project, the most recently written first (the manuscript or any Codex entry). */
export async function listDocs(): Promise<DocMeta[]> {
  await ready();
  let entries: Dirent[];
  try {
    entries = await readdir(DOCS_DIR, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  const docs = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && isValidId(e.name))
      .map(async ({ name: id }): Promise<DocMeta | null> => {
        try {
          const file = fileOf(id);
          const [content, info, cover, codex] = await Promise.all([
            readFile(file, "utf8"),
            stat(file),
            findCover(id),
            lastCodexEdit(id),
          ]);
          return {
            id,
            title: titleOf(content, id),
            words: wordCount(content),
            modified: Math.max(info.mtimeMs, codex),
            cover: cover?.mtime ?? null,
          };
        } catch (err) {
          if (isMissing(err)) return null; // not a project, or deleted meanwhile
          throw err;
        }
      }),
  );
  return docs.filter((d): d is DocMeta => d !== null).sort((a, b) => b.modified - a.modified);
}

/** Create a new project, naming its folder after `name` (or its H1). */
export function createDoc(content: string, name?: string): Promise<Doc> {
  return serialize(async () => {
    await mkdir(DOCS_DIR, { recursive: true });
    const base = slugify(name || titleOf(content, "")) || "untitled";
    for (let i = 1; ; i++) {
      const id = `${base.slice(0, 72)}${i > 1 ? `-${i}` : ""}`;
      try {
        await mkdir(dirOf(id)); // fails if taken, so we never write into a sibling
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw err;
      }
      await writeAtomic(fileOf(id), content);
      return { id, content, version: versionOf(content) };
    }
  });
}

/**
 * Write a manuscript if the caller's baseVersion still matches what's on disk.
 * `force` skips the check (used to resolve a conflict with "keep mine").
 * A project deleted elsewhere is recreated rather than losing the writing.
 * `track`: count the change in the writing stats (the writer's own saves).
 */
export function writeDoc(
  id: string,
  content: string,
  baseVersion: string | null,
  force = false,
  track?: Pastes,
): Promise<WriteResult> {
  return serialize(async () => {
    const current = await readDoc(id);
    if (stale(current, content, baseVersion, force)) return { ok: false, current: current! };
    if (current?.content !== content) {
      if (current) {
        const { mtimeMs } = await stat(fileOf(id));
        if (Date.now() - mtimeMs >= SESSION_GAP_MS) {
          await versions.addVersion(dirOf(id), current.content, "auto", "Session start");
        }
      }
      await writeAtomic(fileOf(id), content);
      if (track) {
        const title = titleOf(content, id);
        trackSave({ book: id, kind: "manuscript", before: current?.content ?? "", after: content, ...track, title });
      }
    }
    return { ok: true, version: versionOf(content) };
  });
}

/** Move a whole project (manuscript and versions) to .trash/. False if missing. */
export function trashDoc(id: string): Promise<boolean> {
  return serialize(async () => {
    try {
      await stat(fileOf(id));
      await rename(dirOf(id), await trashPath(id));
      return true;
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  });
}

export type RenameResult = "ok" | "missing" | "taken" | "invalid";

/**
 * Give a project a new id (its folder, and its URLs). The old id is recorded
 * so links, and editors still open under it, reach the project at its new one.
 */
export function renameDoc(id: string, to: string): Promise<RenameResult> {
  if (!isValidId(id) || !isValidId(to)) return Promise.resolve("invalid");
  return serialize(async () => {
    if (!(await projectExists(id))) return "missing";
    if (id === to) return "ok";
    try {
      await stat(dirOf(to)); // rename() would happily replace an empty folder
      return "taken";
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
    // A project that has talked to Construct keeps its agent's folder name, and with it the agent's memory.
    try {
      await stat(chatsDir(id));
      await pinAgentHome(id);
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
    await rename(dirOf(id), dirOf(to));
    await recordRename(id, to);
    return "ok";
  });
}
