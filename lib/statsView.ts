import { addTotals, emptyTotals, type Slot, type StatsKind, type Totals } from "./writingStats";

// The writing stats sorted into the browser's own hours and days: Today by
// hour, the last 7 or 30 days by day. Pure; the stats page and the library's
// card draw what this returns.

export type Range = "today" | "7d" | "30d";
export const RANGES: { id: Range; label: string; days: number }[] = [
  { id: "today", label: "Today", days: 1 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
];

export type Bucket = { start: number; end: number; totals: Totals };
export type BookTotals = { book: string; totals: Totals };
export type Summary = { start: number; end: number; totals: Totals; buckets: Bucket[]; books: BookTotals[] };

/** Local midnight `daysBack` days before the day of `now`. */
export function dayStart(now: number, daysBack = 0): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d.getTime();
}

function buckets(range: Range, now: number): Bucket[] {
  const days = RANGES.find((r) => r.id === range)!.days;
  const out: Bucket[] = [];
  if (range === "today") {
    // Local hours, by the clock (a day changing to or from summer time has 23 or 25).
    const start = dayStart(now);
    const end = dayStart(now, -1);
    for (let h = 0; ; h++) {
      const d = new Date(start);
      d.setHours(h);
      if (d.getTime() >= end) break;
      const next = new Date(start);
      next.setHours(h + 1);
      out.push({ start: d.getTime(), end: Math.min(next.getTime(), end), totals: emptyTotals() });
    }
    return out;
  }
  for (let i = days - 1; i >= 0; i--) out.push({ start: dayStart(now, i), end: dayStart(now, i - 1), totals: emptyTotals() });
  return out;
}

/**
 * What was written in `range` up to `now`: totals, per hour or day, and per
 * book (most written first). Only `kind` counts (the page shows the manuscript;
 * the Codex is kept for later), and only `book` if given.
 */
export function summarize(
  slots: Slot[],
  range: Range,
  now: number,
  { kind = "manuscript", book }: { kind?: StatsKind; book?: string } = {},
): Summary {
  const bs = buckets(range, now);
  const start = bs[0].start;
  const end = bs[bs.length - 1].end;
  const totals = emptyTotals();
  const books = new Map<string, Totals>();
  for (const s of slots) {
    if (s.kind !== kind || (book && s.book !== book) || s.t < start || s.t >= end) continue;
    addTotals(totals, s);
    addTotals(books.get(s.book) ?? books.set(s.book, emptyTotals()).get(s.book)!, s);
    const b = bs.find((x) => s.t >= x.start && s.t < x.end);
    if (b) addTotals(b.totals, s);
  }
  return {
    start,
    end,
    totals,
    buckets: bs,
    books: [...books]
      .map(([b, t]) => ({ book: b, totals: t }))
      .sort((x, y) => y.totals.drafted + y.totals.editAdded - (x.totals.drafted + x.totals.editAdded)),
  };
}

/** "1 h 20 min", "45 min", "under a minute"; "—" for none. */
export function duration(ms: number): string {
  if (ms <= 0) return "—";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}
