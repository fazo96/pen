// How the library's books are arranged on shelves. Pure functions only (no
// pen imports), shared by the server (lib/shelves.ts) and the homepage, and
// loaded by the tests with plain Node.

export type ShelfRow = { id: string; name: string; books: string[] };
export type Layout = { shelves: ShelfRow[] };

export const MAX_SHELF_NAME = 80;
const MAX_SHELVES = 200;
const MAX_BOOKS = 10_000;
const SHELF_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const BOOK_ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

export const newShelfId = () => `s-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const cleanName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, MAX_SHELF_NAME);

/** A layout from untrusted JSON (a request body, the file on disk), or null if it isn't one. */
export function sanitize(input: unknown): Layout | null {
  const shelves = (input as { shelves?: unknown } | null)?.shelves;
  if (!Array.isArray(shelves) || shelves.length > MAX_SHELVES) return null;
  const out: ShelfRow[] = [];
  const shelfIds = new Set<string>();
  let books = 0;
  for (const s of shelves) {
    const { id, name, books: ids } = (s ?? {}) as Record<string, unknown>;
    if (typeof id !== "string" || !SHELF_ID_RE.test(id) || shelfIds.has(id)) return null;
    if (typeof name !== "string" || !Array.isArray(ids)) return null;
    if (!ids.every((b) => typeof b === "string" && BOOK_ID_RE.test(b))) return null;
    books += ids.length;
    if (books > MAX_BOOKS) return null;
    shelfIds.add(id);
    out.push({ id, name: cleanName(name), books: ids as string[] });
  }
  return { shelves: out };
}

/**
 * The layout for the books that actually exist: gone ones dropped, each book
 * on one shelf only, and books the layout doesn't know yet (new, imported, or
 * from before shelves) at the front of the first shelf, in the order given.
 */
export function arrange(layout: Layout | null, bookIds: string[]): Layout {
  const exists = new Set(bookIds);
  const placed = new Set<string>();
  const shelves = (layout?.shelves ?? []).map((s) => ({
    ...s,
    books: s.books.filter((b) => exists.has(b) && !placed.has(b) && placed.add(b)),
  }));
  if (shelves.length === 0) shelves.push({ id: "main", name: "", books: [] });
  const loose = bookIds.filter((b) => !placed.has(b));
  shelves[0] = { ...shelves[0], books: [...loose, ...shelves[0].books] };
  return { shelves };
}

/** Where a book is: its shelf and position, or null. */
export function findBook(layout: Layout, bookId: string): { shelf: string; index: number } | null {
  for (const s of layout.shelves) {
    const index = s.books.indexOf(bookId);
    if (index >= 0) return { shelf: s.id, index };
  }
  return null;
}

/** Put a book on a shelf at `index`, counted among that shelf's other books (clamped). */
export function moveBook(layout: Layout, bookId: string, shelfId: string, index: number): Layout {
  if (!layout.shelves.some((s) => s.id === shelfId)) return layout;
  return {
    shelves: layout.shelves.map((s) => {
      const books = s.books.filter((b) => b !== bookId);
      if (s.id === shelfId) books.splice(Math.max(0, Math.min(index, books.length)), 0, bookId);
      return books.length === s.books.length && s.id !== shelfId ? s : { ...s, books };
    }),
  };
}

export function addShelf(layout: Layout, id: string, name = ""): Layout {
  return { shelves: [...layout.shelves, { id, name: cleanName(name), books: [] }] };
}

export function renameShelf(layout: Layout, id: string, name: string): Layout {
  return { shelves: layout.shelves.map((s) => (s.id === id ? { ...s, name: cleanName(name) } : s)) };
}

/** Remove a shelf; its books go to the end of the first remaining one. The last shelf stays. */
export function removeShelf(layout: Layout, id: string): Layout {
  const gone = layout.shelves.find((s) => s.id === id);
  if (!gone || layout.shelves.length < 2) return layout;
  const shelves = layout.shelves.filter((s) => s !== gone);
  shelves[0] = { ...shelves[0], books: [...shelves[0].books, ...gone.books] };
  return { shelves };
}

/** Move a shelf up (-1) or down (+1) among the others. */
export function moveShelf(layout: Layout, id: string, delta: number): Layout {
  const from = layout.shelves.findIndex((s) => s.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= layout.shelves.length) return layout;
  const shelves = [...layout.shelves];
  const [shelf] = shelves.splice(from, 1);
  shelves.splice(to, 0, shelf);
  return { shelves };
}

/** The layout with a book's id changed, in the same place. */
export function renameBook(layout: Layout, from: string, to: string): Layout {
  return { shelves: layout.shelves.map((s) => ({ ...s, books: s.books.map((b) => (b === from ? to : b)) })) };
}

/**
 * The layout with books that were renamed away (`renames`: old id → current
 * id) under their current ids, so a page opened before a rename, saving its
 * arrangement after it, doesn't knock the renamed book off its place. An old
 * id that's a book again (`exists`) is left alone.
 */
export function followRenames(layout: Layout, renames: Record<string, string>, exists: Set<string>): Layout {
  const current = (b: string) => (!exists.has(b) && renames[b]) || b;
  return { shelves: layout.shelves.map((s) => ({ ...s, books: s.books.map(current) })) };
}
