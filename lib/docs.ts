import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { slugify, titleOf, wordCount } from "./text";

// The library: every document is one markdown file in this directory.
export const DOCS_DIR = path.resolve(
  /*turbopackIgnore: true*/
  process.env.PEN_DIR ?? path.join(process.cwd(), "data"),
);
const TRASH_DIR = path.join(DOCS_DIR, ".trash");

export const MAX_BYTES = 5 * 1024 * 1024;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

export type Doc = { id: string; content: string; version: string };
export type DocMeta = { id: string; title: string; words: number; modified: number };

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

function fileOf(id: string) {
  if (!isValidId(id)) throw new Error(`invalid id: ${id}`);
  return path.join(DOCS_DIR, `${id}.md`);
}

export function versionOf(content: string): string {
  return createHash("sha1").update(content).digest("hex").slice(0, 12);
}

function isMissing(err: unknown) {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}

export async function listDocs(): Promise<DocMeta[]> {
  let names: string[];
  try {
    names = await readdir(DOCS_DIR);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  const docs = await Promise.all(
    names
      .filter((n) => n.endsWith(".md") && isValidId(n.slice(0, -3)))
      .map(async (n): Promise<DocMeta | null> => {
        const id = n.slice(0, -3);
        try {
          const file = path.join(DOCS_DIR, n);
          const [content, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
          return { id, title: titleOf(content, id), words: wordCount(content), modified: info.mtimeMs };
        } catch (err) {
          if (isMissing(err)) return null; // deleted between readdir and read
          throw err;
        }
      }),
  );
  return docs.filter((d): d is DocMeta => d !== null).sort((a, b) => b.modified - a.modified);
}

export async function readDoc(id: string): Promise<Doc | null> {
  if (!isValidId(id)) return null;
  try {
    const content = await readFile(fileOf(id), "utf8");
    return { id, content, version: versionOf(content) };
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

async function writeAtomic(id: string, content: string) {
  await mkdir(DOCS_DIR, { recursive: true });
  const file = fileOf(id);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

// All mutations run through one queue so read-compare-write never interleaves.
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

/** Create a new document, naming its file after `name` (or its H1). */
export function createDoc(content: string, name?: string): Promise<Doc> {
  return serialize(async () => {
    await mkdir(DOCS_DIR, { recursive: true });
    const base = slugify(name || titleOf(content, "")) || "untitled";
    for (let i = 1; ; i++) {
      const id = `${base.slice(0, 72)}${i > 1 ? `-${i}` : ""}`;
      try {
        // "wx" fails if the file exists, so we never overwrite a sibling.
        await writeFile(fileOf(id), content, { encoding: "utf8", flag: "wx" });
        return { id, content, version: versionOf(content) };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
  });
}

export type WriteResult = { ok: true; version: string } | { ok: false; current: Doc };

/**
 * Write a document if the caller's baseVersion still matches what's on disk.
 * `force` skips the check (used to resolve a conflict with "keep mine").
 * A document deleted elsewhere is recreated rather than losing the writing.
 */
export function writeDoc(
  id: string,
  content: string,
  baseVersion: string | null,
  force = false,
): Promise<WriteResult> {
  return serialize(async () => {
    const current = await readDoc(id);
    if (current && !force && baseVersion !== null && baseVersion !== current.version) {
      return { ok: false, current };
    }
    if (current?.content !== content) await writeAtomic(id, content);
    return { ok: true, version: versionOf(content) };
  });
}

/** Move a document to .trash/ (recoverable by hand). Returns false if missing. */
export function trashDoc(id: string): Promise<boolean> {
  return serialize(async () => {
    await mkdir(TRASH_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      await rename(fileOf(id), path.join(TRASH_DIR, `${id}--${stamp}.md`));
      return true;
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  });
}
