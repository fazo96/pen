import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { GLOBAL, isValidId } from "../ids";
import { DOCS_DIR } from "../paths";
import { queue } from "../queue";
import type { Doc } from "../types";

// The library on disk: one folder per project, holding manuscript.md (the
// master copy), versions/, codex/, construct/, spot.json and a cover. This
// module knows the layout and keeps the one queue every change goes through;
// its siblings in lib/store/ each look after one part (lib/docs.ts gathers them).
// The Global Codex (owner GLOBAL) has a folder laid out the same way, minus
// the manuscript: .pen-global/ holds its codex/, construct/ and spot.json.

const MANUSCRIPT = "manuscript.md";
const TRASH_DIR = path.join(DOCS_DIR, ".trash");
export const GLOBAL_DIR = path.join(DOCS_DIR, ".pen-global");

export const MAX_BYTES = 5 * 1024 * 1024;

export function dirOf(id: string) {
  if (id === GLOBAL) return GLOBAL_DIR;
  if (!isValidId(id)) throw new Error(`invalid id: ${id}`);
  return path.join(DOCS_DIR, id);
}
export function fileOf(id: string) {
  if (!isValidId(id)) throw new Error(`invalid id: ${id}`); // the Global Codex has no manuscript
  return path.join(dirOf(id), MANUSCRIPT);
}

export const codexDir = (id: string) => path.join(dirOf(id), "codex");
export function entryFile(id: string, eid: string) {
  if (!isValidId(eid)) throw new Error(`invalid entry id: ${eid}`);
  return path.join(codexDir(id), `${eid}.md`);
}

export const chatsDir = (id: string) => path.join(dirOf(id), "construct");

export const spotFile = (id: string) => path.join(dirOf(id), "spot.json");

/** Where to move something trashed: `.trash/<name>--<time><ext>`, the folder made if missing. */
export async function trashPath(name: string, ext = ""): Promise<string> {
  await mkdir(TRASH_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(TRASH_DIR, `${name}--${stamp}${ext}`);
}

export function versionOf(content: string): string {
  return createHash("sha1").update(content).digest("hex").slice(0, 12);
}

export function isMissing(err: unknown) {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}

// All mutations run through one queue so read-compare-write never interleaves.
const docsQueue = queue("docs");
export function serialize<T>(fn: () => Promise<T>): Promise<T> {
  return docsQueue(() => ready().then(fn));
}

// One-time move from the old flat layout (data/<id>.md) to data/<id>/manuscript.md.
let migrated: Promise<void> | null = null;
export function ready(): Promise<void> {
  migrated ??= (async () => {
    let names: string[];
    try {
      names = await readdir(DOCS_DIR);
    } catch (err) {
      if (isMissing(err)) return;
      throw err;
    }
    for (const n of names) {
      const id = n.slice(0, -3);
      if (!n.endsWith(".md") || !isValidId(id)) continue;
      try {
        await mkdir(dirOf(id)); // fails if the folder already exists: leave both alone
      } catch {
        continue;
      }
      await rename(path.join(DOCS_DIR, n), fileOf(id));
    }
  })().catch((err) => {
    migrated = null; // retry on the next call
    throw err;
  });
  return migrated;
}

export async function readDoc(id: string): Promise<Doc | null> {
  if (!isValidId(id)) return null;
  await ready();
  try {
    const content = await readFile(fileOf(id), "utf8");
    return { id, content, version: versionOf(content) };
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

/** A book with a manuscript, or the Global Codex, which is always there. */
export async function projectExists(id: string) {
  return id === GLOBAL || (await readDoc(id)) !== null;
}

/**
 * A save based on an older version than the file's, unless the file already holds
 * exactly this text: then it overwrites nothing. That happens when one change arrives
 * twice, as when a page being left saves it and the next one sends its backup.
 */
export function stale(
  current: { content: string; version: string } | null,
  content: string,
  baseVersion: string | null,
  force: boolean,
): boolean {
  return !!current && !force && baseVersion !== null && baseVersion !== current.version && current.content !== content;
}

export type WriteResult = { ok: true; version: string } | { ok: false; current: Doc };
