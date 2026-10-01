import "server-only";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isValidId, listCodex, listDocs, listVersions } from "./docs";
import { DOCS_DIR } from "./paths";
import { getShelves } from "./shelves";
import type { ZipSource } from "./zip";

// Figures for the settings pages, and the files that go into an export.

const TRASH_DIR = path.join(DOCS_DIR, ".trash");
// What a library export holds besides the book folders and the trash. Anything
// else in the data folder (the password hash, Construct's sign-in state under
// .claude in Docker) stays out.
const LIBRARY_FILES = [".pen-shelves.json", ".pen-renames.json", ".pen-grammar.json"];

export type Stats = {
  words: number;
  codexEntries: number;
  codexWords: number;
  namedVersions: number;
  autoVersions: number;
  /** On disk, trash not included. */
  bytes: number;
  trashBytes: number;
};
export type LibraryStats = Stats & { books: number; shelves: number; totalBytes: number };

/** Bytes under a file or folder (0 if missing). Symlinks count as themselves. */
async function sizeOf(p: string): Promise<number> {
  try {
    const info = await lstat(p);
    if (!info.isDirectory()) return info.size;
    const names = await readdir(p);
    const sizes = await Promise.all(names.map((n) => sizeOf(path.join(p, n))));
    return sizes.reduce((a, b) => a + b, 0);
  } catch {
    return 0;
  }
}

async function list(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** A book's trashed things: its folder if deleted, or entries, chats and covers it lost. Named "<id>--…". */
async function trashOf(id: string): Promise<string[]> {
  return (await list(TRASH_DIR)).filter((n) => n.startsWith(`${id}--`));
}

export async function bookStats(id: string, words: number): Promise<Stats> {
  const [codex, versions, bytes, trash] = await Promise.all([
    listCodex(id),
    listVersions(id),
    sizeOf(path.join(DOCS_DIR, id)),
    trashOf(id),
  ]);
  const trashSizes = await Promise.all(trash.map((n) => sizeOf(path.join(TRASH_DIR, n))));
  return {
    words,
    codexEntries: codex?.length ?? 0,
    codexWords: (codex ?? []).reduce((n, e) => n + e.words, 0),
    namedVersions: versions.filter((v) => v.kind === "named").length,
    autoVersions: versions.filter((v) => v.kind === "auto").length,
    bytes,
    trashBytes: trashSizes.reduce((a, b) => a + b, 0),
  };
}

export async function libraryStats(): Promise<LibraryStats> {
  const docs = await listDocs();
  const [books, shelves, totalBytes, trashBytes] = await Promise.all([
    Promise.all(docs.map((d) => bookStats(d.id, d.words))),
    getShelves(docs.map((d) => d.id)),
    sizeOf(DOCS_DIR),
    sizeOf(TRASH_DIR),
  ]);
  const sum = (k: keyof Stats) => books.reduce((n, b) => n + b[k], 0);
  return {
    books: docs.length,
    shelves: shelves.shelves.length,
    words: sum("words"),
    codexEntries: sum("codexEntries"),
    codexWords: sum("codexWords"),
    namedVersions: sum("namedVersions"),
    autoVersions: sum("autoVersions"),
    bytes: sum("bytes"),
    trashBytes,
    totalBytes,
  };
}

/** Every file under `dir`, named `prefix/…` in the zip. Half-written *.tmp files are skipped. */
async function* filesUnder(dir: string, prefix: string): AsyncGenerator<ZipSource> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const name = `${prefix}/${e.name}`;
    if (e.isDirectory()) yield* filesUnder(full, name);
    else if (e.isFile() && !e.name.endsWith(".tmp")) yield await source(full, name);
  }
}

async function source(file: string, name: string): Promise<ZipSource> {
  const { mtime } = await lstat(file);
  return { name, mtime, read: () => readFile(file).catch(() => null) }; // gone meanwhile: left out
}

/** A book's files for its export: its folder, and its trashed things under .trash/. */
export async function* bookFiles(id: string): AsyncGenerator<ZipSource> {
  if (!isValidId(id)) return;
  yield* filesUnder(path.join(DOCS_DIR, id), id);
  for (const n of await trashOf(id)) {
    const full = path.join(TRASH_DIR, n);
    if ((await lstat(full)).isDirectory()) yield* filesUnder(full, `.trash/${n}`);
    else yield await source(full, `.trash/${n}`);
  }
}

/** The whole library: every book folder, the trash, and the shelves and renames. Unzipped, it's a data folder. */
export async function* libraryFiles(): AsyncGenerator<ZipSource> {
  const names = (await list(DOCS_DIR)).sort();
  for (const n of names) {
    const full = path.join(DOCS_DIR, n);
    if (isValidId(n) && (await lstat(full)).isDirectory()) yield* filesUnder(full, n);
  }
  yield* filesUnder(TRASH_DIR, ".trash");
  for (const n of LIBRARY_FILES) {
    try {
      yield await source(path.join(DOCS_DIR, n), n);
    } catch {} // not there yet
  }
}

/** A streamed zip download. */
export function zipResponse(stream: AsyncGenerator<Uint8Array>, filename: string): Response {
  const body = new ReadableStream<Uint8Array>({
    // One chunk per pull, so files are read as fast as the client downloads.
    async pull(controller) {
      try {
        const { value, done } = await stream.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        console.error("export:", err);
        controller.error(err);
      }
    },
    async cancel() {
      await stream.return(undefined);
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Today's date for file names, like 2026-09-30. */
export const stamp = () => new Date().toLocaleDateString("sv-SE");
