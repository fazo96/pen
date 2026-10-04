import "server-only";
import path from "node:path";
import { listDocs } from "./docs";
import { jsonStore } from "./jsonStore";
import { DOCS_DIR } from "./paths";
import { readRenames } from "./renames";
import { arrange, followRenames, renameBook, sanitize, type Layout } from "./shelfLayout";

// The homepage's shelves: which book sits where. Books the file doesn't
// mention go on the first shelf, so losing it only loses the arrangement
// (missing or unreadable, it reads as null: every book on one shelf).
const store = jsonStore<Layout | null>(path.join(DOCS_DIR, ".pen-shelves.json"), sanitize, () => null);

/** The shelves for these books (as listed by listDocs, newest first). */
export async function getShelves(bookIds: string[]): Promise<Layout> {
  return arrange(await store.read(), bookIds);
}

/** `layout` fitted to the books that exist now, renamed ones under their new ids. */
async function fit(layout: Layout): Promise<Layout> {
  const ids = (await listDocs()).map((d) => d.id);
  return arrange(followRenames(layout, await readRenames(), new Set(ids)), ids);
}

/** Save an arrangement, fitted to the books that exist now. Returns what was saved. */
export async function saveShelves(layout: Layout): Promise<Layout> {
  return (await store.update(() => fit(layout)))!;
}

/** Keep a renamed book where it was. */
export async function renameOnShelves(from: string, to: string): Promise<void> {
  await store.update((layout) => (layout ? fit(renameBook(layout, from, to)) : layout));
}
