import assert from "node:assert/strict";
import { test } from "node:test";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import {
  droppedEntry,
  entrySpot,
  noSpots,
  placeOf,
  posOf,
  renamedEntry,
  sanitizeSpot,
  sanitizeSpots,
  withLast,
  withSpot,
} from "../lib/spot.ts";

const extensions = [StarterKit.configure({ heading: { levels: [1, 2, 3] } })];
const schema = getSchema(extensions);
const md = new MarkdownManager({ extensions });
const docOf = (markdown: string) => schema.nodeFromJSON(md.parse(markdown));

const before = docOf("# Title\n\nThe rain came early.\n\nShe waited by the door.\n\nNobody came.");
/** Positions of each textblock with this text, in order. */
const starts = (doc: ReturnType<typeof docOf>, text: string) => {
  const out: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock && node.textContent === text) out.push(pos + 1);
    return !node.isTextblock;
  });
  return out;
};
const posIn = (doc: ReturnType<typeof docOf>, text: string, off: number) => starts(doc, text)[0] + off;

test("a place round-trips in the same text", () => {
  const pos = posIn(before, "She waited by the door.", 4);
  const place = placeOf(before, pos);
  assert.equal(place.q, "She waited by the door.");
  assert.equal(place.off, 4);
  assert.equal(posOf(before, place), pos);
});

test("a place is found by its words after text is added above it", () => {
  const place = placeOf(before, posIn(before, "She waited by the door.", 4));
  const after = docOf("# Title\n\nA new opening paragraph.\n\nThe rain came early.\n\nShe waited by the door.\n\nNobody came.");
  assert.equal(posOf(after, place), posIn(after, "She waited by the door.", 4));
});

test("the nearest of two matching paragraphs wins", () => {
  const doc = docOf("Again.\n\nMiddle.\n\nAgain.");
  const [first, last] = starts(doc, "Again.");
  assert.equal(posOf(doc, placeOf(doc, last + 2)), last + 2);
  assert.equal(posOf(doc, placeOf(doc, first + 2)), first + 2);
});

test("an offset past a shortened paragraph lands at its end", () => {
  const doc = docOf("Short now.");
  assert.equal(posOf(doc, { block: 0, q: "Short", off: 40 }), posIn(doc, "Short now.", 10));
});

test("a paragraph whose opening was edited is found by position", () => {
  const place = placeOf(before, posIn(before, "She waited by the door.", 4));
  const after = docOf("# Title\n\nThe rain came early.\n\nHe waited by the door.\n\nNobody came.");
  assert.equal(posOf(after, place), posIn(after, "He waited by the door.", 4));
});

test("a vanished paragraph falls back to its old position, clamped", () => {
  const place = { block: 9999, q: "Gone for good", off: 3 };
  assert.equal(posOf(before, place), posIn(before, "Nobody came.", 3));
});

test("sanitizeSpot keeps good spots and rejects bad ones", () => {
  const p = { block: 3, q: "Hi", off: 1 };
  assert.deepEqual(sanitizeSpot({ anchor: p, head: p, top: p, extra: 1 }), { anchor: p, head: p, top: p });
  assert.equal(sanitizeSpot({ anchor: p, head: p }), null);
  assert.equal(sanitizeSpot({ anchor: { ...p, block: -1 }, head: p, top: p }), null);
  assert.equal(sanitizeSpot({ anchor: { ...p, q: 3 }, head: p, top: p }), null);
  assert.equal(sanitizeSpot(null), null);
  assert.equal(sanitizeSpot({ anchor: { ...p, q: "x".repeat(500) }, head: p, top: p })?.anchor.q.length, 120);
});

const spotAt = (block: number) => ({ anchor: { block, q: "", off: 0 }, head: { block, q: "", off: 0 }, top: { block, q: "", off: 0 } });

test("an old spot.json (a lone spot) is the manuscript's", () => {
  assert.deepEqual(sanitizeSpots(spotAt(4)), { manuscript: spotAt(4), entries: [] });
  assert.deepEqual(sanitizeSpots("nonsense"), noSpots());
});

test("entry spots: most recent last, the last viewed follows", () => {
  let s = withSpot(noSpots(), null, spotAt(1));
  s = withSpot(s, "mara", spotAt(2));
  s = withSpot(s, "the-mill", spotAt(3));
  s = withSpot(s, "mara", spotAt(5));
  assert.deepEqual(s.entries.map(([e]) => e), ["the-mill", "mara"]);
  assert.equal(s.last, "mara");
  assert.deepEqual(entrySpot(s, "mara"), spotAt(5));
  assert.deepEqual(s.manuscript, spotAt(1));
  assert.equal(withLast(s, "the-mill").last, "the-mill");
  assert.deepEqual(sanitizeSpots(JSON.parse(JSON.stringify(s))), s);
});

test("entry spots are capped at 50", () => {
  let s = noSpots();
  for (let i = 0; i < 60; i++) s = withSpot(s, `e${i}`, spotAt(i));
  assert.equal(s.entries.length, 50);
  assert.equal(s.entries[0][0], "e10");
  assert.equal(s.last, "e59");
});

test("renaming and deleting entries carries their spots along", () => {
  const s = withSpot(withSpot(noSpots(), "mara", spotAt(2)), "old", spotAt(3));
  const renamed = renamedEntry(s, "old", "new");
  assert.deepEqual(entrySpot(renamed, "new"), spotAt(3));
  assert.equal(entrySpot(renamed, "old"), undefined);
  assert.equal(renamed.last, "new");
  const dropped = droppedEntry(renamed, "new");
  assert.deepEqual(dropped.entries.map(([e]) => e), ["mara"]);
  assert.equal("last" in dropped, false);
});

test("sanitizeSpots drops bad entries", () => {
  const s = sanitizeSpots({
    entries: [["Bad Id", spotAt(1)], ["ok", spotAt(2)], ["ok", spotAt(3)], ["nospot", {}], "junk"],
    last: "../etc",
  });
  assert.deepEqual(s, { entries: [["ok", spotAt(2)]] });
});
