import "server-only";
import { type DocMeta, GLOBAL, listDocs } from "./docs";
import { readRenames } from "./renames";
import { entryKey, readEntryRenames, readSlots } from "./store/stats";
import type { Slot } from "./writingStats";

// The writing stats as the pages and /api/stats get them: slots under each
// book's and Codex entry's current id (renames followed), every book's title,
// gone ones' as they last were, and the entries' last titles. The browser
// sorts the slots into its own days (lib/statsView.ts).

export type StatsBook = { title: string; gone: boolean };
/** `entries`: Codex entries' last titles, by "<book>/<entry>". */
export type WritingReport = { slots: Slot[]; books: Record<string, StatsBook>; entries: Record<string, string> };

/** Enough to cover the last 30 days in any time zone. */
export const REPORT_DAYS = 32;

/** Slots starting in [from, to). `docs`: the library's books, if the caller has them already. */
export async function writingReport(from: number, to: number, docs?: DocMeta[]): Promise<WritingReport> {
  const [{ slots, titles, entries }, renames, entryRenames, books] = await Promise.all([
    readSlots(from, to),
    readRenames(),
    readEntryRenames(),
    docs ?? listDocs(),
  ]);
  // An entry renamed before its book was is filed under the book's old id, after, under the new one.
  const entryOf = (was: string, book: string, entry: string) => {
    const to = entryRenames[entryKey(was, entry)] ?? entryRenames[entryKey(book, entry)];
    return to ? to.slice(to.indexOf("/") + 1) : entry;
  };
  const out: WritingReport = { slots: [], books: {}, entries: {} };
  for (const d of books) out.books[d.id] = { title: d.title, gone: false };
  // The Global Codex's entries are recorded under GLOBAL (kind "codex"); it's always there.
  out.books[GLOBAL] = { title: "Global Codex", gone: false };
  for (const s of slots) {
    const book = renames[s.book] ?? s.book;
    const entry = s.entry && entryOf(s.book, book, s.entry);
    out.slots.push(book === s.book && entry === s.entry ? s : { ...s, book, ...(entry ? { entry } : {}) });
    out.books[book] ??= { title: titles[book] ?? titles[s.book] ?? book, gone: true };
    if (s.entry && entry) {
      const title = entries[entryKey(book, entry)] ?? entries[entryKey(s.book, s.entry)];
      if (title) out.entries[entryKey(book, entry)] = title;
    }
  }
  return out;
}

/** The last REPORT_DAYS days. */
export const recentWriting = (docs?: DocMeta[]) => {
  const now = Date.now();
  return writingReport(now - REPORT_DAYS * 86_400_000, now + 60_000, docs);
};
