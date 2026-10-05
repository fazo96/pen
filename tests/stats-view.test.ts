import assert from "node:assert/strict";
import { test } from "node:test";
import { dayStart, duration, summarize } from "../lib/statsView.ts";
import type { Slot } from "../lib/writingStats.ts";

// The writing stats sorted into the browser's hours and days (lib/statsView.ts).

const slot = (t: number, o: Partial<Slot> = {}): Slot => ({
  t,
  book: "rain",
  kind: "manuscript",
  drafted: 10,
  editAdded: 0,
  removed: 0,
  pasted: 0,
  saves: 1,
  activeMs: 60_000,
  ...o,
});

// Noon, so "today" has room either side in any time zone.
const now = new Date(2026, 9, 5, 12, 30).getTime();

test("today is split into the day's hours; older slots are left out", () => {
  const s = summarize([slot(now - 60 * 60_000), slot(now - 5 * 60_000, { removed: 3 }), slot(dayStart(now) - 1)], "today", now);
  assert.equal(s.buckets.length, 24);
  assert.equal(s.start, dayStart(now));
  assert.equal(s.totals.drafted, 20);
  assert.equal(s.totals.removed, 3);
  assert.equal(s.buckets[11].totals.drafted, 10);
  assert.equal(s.buckets[12].totals.removed, 3);
});

test("7 and 30 days are split by day, ending today", () => {
  const week = summarize([slot(now), slot(dayStart(now, 6)), slot(dayStart(now, 7))], "7d", now);
  assert.equal(week.buckets.length, 7);
  assert.equal(week.totals.drafted, 20);
  assert.equal(week.buckets[0].totals.drafted, 10);
  assert.equal(week.buckets[6].totals.drafted, 10);
  assert.equal(summarize([], "30d", now).buckets.length, 30);
});

test("only the manuscript counts unless asked, and one book if picked; books sort by words written", () => {
  const slots = [slot(now), slot(now, { kind: "codex", drafted: 99 }), slot(now, { book: "sun", drafted: 50 })];
  const all = summarize(slots, "today", now);
  assert.equal(all.totals.drafted, 60);
  assert.deepEqual(
    all.books.map((b) => b.book),
    ["sun", "rain"],
  );
  assert.equal(summarize(slots, "today", now, { book: "rain" }).totals.drafted, 10);
  assert.equal(summarize(slots, "today", now, { kind: "codex" }).totals.drafted, 99);
});

test("duration", () => {
  assert.equal(duration(0), "—");
  assert.equal(duration(20_000), "under a minute");
  assert.equal(duration(45 * 60_000), "45 min");
  assert.equal(duration(80 * 60_000), "1 h 20 min");
  assert.equal(duration(120 * 60_000), "2 h");
});
