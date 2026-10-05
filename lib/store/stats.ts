import "server-only";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { isValidId } from "../ids";
import { type JsonStore, jsonStore } from "../jsonStore";
import { DOCS_DIR } from "../paths";
import { measureEdit, type Slot, type StatsKind } from "../writingStats";

export type { Slot, StatsKind } from "../writingStats";

// Writing stats: what each save changed (lib/writingStats.ts), summed into
// 15-minute slots per book and kind, in PEN_DIR/.pen-stats/<YYYY-MM>.json (UTC
// months, so only the current month's file is ever rewritten; kept forever).
// Library-wide rather than per book, so a book's history outlives the book:
// slots keep the id the book had then, and `titles` its last title.

export const STATS_DIR = path.join(DOCS_DIR, ".pen-stats");

/** Slots are 15 minutes, so the page can sort them into local days in any time zone. */
export const SLOT_MS = 15 * 60_000;
/** A save within this long of the book's last one counts the time between as writing. */
const ACTIVE_GAP_MS = 5 * 60_000;

type Month = { slots: Slot[]; titles: Record<string, string> };

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);

function parseMonth(raw: unknown): Month {
  const data = (raw ?? {}) as { slots?: unknown; titles?: unknown };
  const slots: Slot[] = [];
  for (const s of Array.isArray(data.slots) ? data.slots : []) {
    const o = (s ?? {}) as Record<string, unknown>;
    if (!isValidId(o.book) || (o.kind !== "manuscript" && o.kind !== "codex") || !num(o.t)) continue;
    slots.push({
      t: num(o.t),
      book: o.book,
      kind: o.kind,
      drafted: num(o.drafted),
      editAdded: num(o.editAdded),
      removed: num(o.removed),
      pasted: num(o.pasted),
      saves: num(o.saves),
      activeMs: num(o.activeMs),
    });
  }
  const titles: Record<string, string> = {};
  if (data.titles && typeof data.titles === "object")
    for (const [k, v] of Object.entries(data.titles)) if (isValidId(k) && typeof v === "string") titles[k] = v;
  return { slots, titles };
}

const monthOf = (t: number) => new Date(t).toISOString().slice(0, 7);

const stores = new Map<string, JsonStore<Month>>();
function monthStore(month: string) {
  let s = stores.get(month);
  if (!s) {
    s = jsonStore(path.join(STATS_DIR, `${month}.json`), parseMonth, () => ({ slots: [], titles: {} }));
    stores.set(month, s);
  }
  return s;
}

// When each book was last saved, for active time. Lost on restart, which only
// leaves out the time before the first save after it.
const g = globalThis as { penLastSave?: Map<string, number> };
const lastSave = (g.penLastSave ??= new Map());

export type SaveRecord = {
  book: string;
  kind: StatsKind;
  before: string;
  after: string;
  /** Words the editor reported pasting since its last save. */
  pasted: number;
  /** The manuscript's title, remembered for when the book is gone. */
  title?: string;
  now?: number;
};

/** Add one save to its slot. */
export async function recordSave({ book, kind, before, after, pasted, title, now = Date.now() }: SaveRecord): Promise<void> {
  const delta = measureEdit(before, after, pasted);
  const last = lastSave.get(book);
  lastSave.set(book, now);
  const activeMs = last !== undefined && now - last >= 0 && now - last <= ACTIVE_GAP_MS ? now - last : 0;
  const t = Math.floor(now / SLOT_MS) * SLOT_MS;
  await monthStore(monthOf(t)).update((m) => {
    const slots = [...m.slots];
    const i = slots.findIndex((s) => s.t === t && s.book === book && s.kind === kind);
    const s = i < 0 ? { t, book, kind, drafted: 0, editAdded: 0, removed: 0, pasted: 0, saves: 0, activeMs: 0 } : slots[i];
    const next = {
      ...s,
      drafted: s.drafted + delta.drafted,
      editAdded: s.editAdded + delta.editAdded,
      removed: s.removed + delta.removed,
      pasted: s.pasted + delta.pasted,
      saves: s.saves + 1,
      activeMs: s.activeMs + activeMs,
    };
    if (i < 0) slots.push(next);
    else slots[i] = next;
    const titles = title && m.titles[book] !== title ? { ...m.titles, [book]: title } : m.titles;
    return { slots, titles };
  });
}

// Saves are recorded one after another, after the save has answered: stats are
// never worth slowing down or failing a save.
let pending: Promise<void> = Promise.resolve();

/** Record a save in the background. */
export function trackSave(record: SaveRecord) {
  const now = record.now ?? Date.now();
  pending = pending.then(
    () =>
      new Promise<void>((resolve) =>
        setImmediate(() =>
          recordSave({ ...record, now })
            .catch((err) => console.error("stats:", err))
            .finally(resolve),
        ),
      ),
  );
}

/** Resolves once every tracked save so far is recorded (for tests). */
export const statsSettled = () => pending;

/** Slots starting in [from, to), oldest first, and the last title of each book in those months. */
export async function readSlots(from: number, to: number): Promise<Month> {
  let files: string[];
  try {
    files = await readdir(STATS_DIR);
  } catch {
    return { slots: [], titles: {} };
  }
  const [first, last] = [monthOf(Math.max(0, from)), monthOf(Math.max(0, to - 1))];
  const months = files
    .map((f) => /^(\d{4}-\d{2})\.json$/.exec(f)?.[1])
    .filter((m): m is string => !!m && m >= first && m <= last)
    .sort();
  const out: Month = { slots: [], titles: {} };
  for (const m of months) {
    const { slots, titles } = await monthStore(m).read();
    out.slots.push(...slots.filter((s) => s.t >= from && s.t < to));
    Object.assign(out.titles, titles);
  }
  out.slots.sort((a, b) => a.t - b.t);
  return out;
}
