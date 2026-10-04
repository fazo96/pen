import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { listDocs } from "./docs";
import { writeAtomic } from "./files";
import { DOCS_DIR } from "./paths";
import { queue } from "./queue";
import { readRenames } from "./renames";
import { arrange, followRenames, renameBook, sanitize, type Layout } from "./shelfLayout";

// The homepage's shelves: which book sits where. Books the file doesn't
// mention go on the first shelf, so losing it only loses the arrangement.
const SHELVES_FILE = path.join(DOCS_DIR, ".pen-shelves.json");

async function readLayout(): Promise<Layout | null> {
  try {
    return sanitize(JSON.parse(await readFile(SHELVES_FILE, "utf8")));
  } catch {
    return null; // missing or unreadable: every book on one shelf
  }
}

/** The shelves for these books (as listed by listDocs, newest first). */
export async function getShelves(bookIds: string[]): Promise<Layout> {
  return arrange(await readLayout(), bookIds);
}

const serialize = queue("shelves");

async function write(layout: Layout): Promise<Layout> {
  const ids = (await listDocs()).map((d) => d.id);
  const fitted = arrange(followRenames(layout, await readRenames(), new Set(ids)), ids);
  await writeAtomic(SHELVES_FILE, JSON.stringify(fitted, null, 2));
  return fitted;
}

/** Save an arrangement, fitted to the books that exist now. Returns what was saved. */
export function saveShelves(layout: Layout): Promise<Layout> {
  return serialize(() => write(layout));
}

/** Keep a renamed book where it was. */
export function renameOnShelves(from: string, to: string): Promise<void> {
  return serialize(async () => {
    const layout = await readLayout();
    if (layout) await write(renameBook(layout, from, to));
  });
}
