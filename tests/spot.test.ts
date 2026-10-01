import assert from "node:assert/strict";
import { test } from "node:test";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { placeOf, posOf, sanitizeSpot } from "../lib/spot.ts";

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
