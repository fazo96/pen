import "server-only";
import { type DocMeta, listDocs } from "./docs";
import { readRenames } from "./renames";
import { readSlots } from "./store/stats";
import type { Slot } from "./writingStats";

// The writing stats as the pages and /api/stats get them: slots under each
// book's current id (renames followed), and every book's title, gone ones'
// as they last were. The browser sorts the slots into its own days
// (lib/statsView.ts).

export type StatsBook = { title: string; gone: boolean };
export type WritingReport = { slots: Slot[]; books: Record<string, StatsBook> };

/** Enough to cover the last 30 days in any time zone. */
export const REPORT_DAYS = 32;

/** Slots starting in [from, to). `docs`: the library's books, if the caller has them already. */
export async function writingReport(from: number, to: number, docs?: DocMeta[]): Promise<WritingReport> {
  const [{ slots, titles }, renames, books] = await Promise.all([readSlots(from, to), readRenames(), docs ?? listDocs()]);
  const out: WritingReport = { slots: [], books: {} };
  for (const d of books) out.books[d.id] = { title: d.title, gone: false };
  for (const s of slots) {
    const book = renames[s.book] ?? s.book;
    out.slots.push(book === s.book ? s : { ...s, book });
    out.books[book] ??= { title: titles[book] ?? titles[s.book] ?? book, gone: true };
  }
  return out;
}

/** The last REPORT_DAYS days. */
export const recentWriting = (docs?: DocMeta[]) => {
  const now = Date.now();
  return writingReport(now - REPORT_DAYS * 86_400_000, now + 60_000, docs);
};
