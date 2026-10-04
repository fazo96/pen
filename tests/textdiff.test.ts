import assert from "node:assert/strict";
import { test } from "node:test";
import { alignBlocks, blockKey, countWords, wordDiff } from "../lib/textdiff.ts";

// How two texts differ, block by block, then word by word (lib/textdiff.ts):
// the version preview's Changes and Construct's diff_versions.

test("countWords and blockKey", () => {
  assert.equal(countWords("  The rain,  at last. "), 4);
  assert.equal(countWords(""), 0);
  assert.equal(blockKey("  The\n rain\t fell "), "The rain fell");
});

test("identical texts are all the same", () => {
  const blocks = ["# Title", "One.", "Two."];
  assert.deepEqual(alignBlocks(blocks, blocks), [
    { op: "same", a: 0, b: 0 },
    { op: "same", a: 1, b: 1 },
    { op: "same", a: 2, b: 2 },
  ]);
});

test("an edited paragraph pairs with its old self; unrelated ones are added and removed", () => {
  const before = ["# Title", "Mara walked to the harbour in the rain.", "The end."];
  const after = ["# Title", "Mara ran to the harbour in the rain.", "A wholly new scene begins here.", "The end."];
  assert.deepEqual(alignBlocks(before, after), [
    { op: "same", a: 0, b: 0 },
    { op: "changed", a: 1, b: 1 },
    { op: "added", b: 2 },
    { op: "same", a: 2, b: 3 },
  ]);
  assert.deepEqual(alignBlocks(["Old words entirely.", "Kept."], ["Something else now.", "Kept."]), [
    { op: "removed", a: 0 },
    { op: "added", b: 0 },
    { op: "same", a: 1, b: 1 },
  ]);
});

test("pairs keep document order when several blocks change at once", () => {
  const before = ["The ship left at dawn.", "Nobody waved from the pier."];
  const after = ["Inserted first.", "The ship left at noon.", "Nobody waved from the old pier."];
  assert.deepEqual(alignBlocks(before, after), [
    { op: "added", b: 0 },
    { op: "changed", a: 0, b: 1 },
    { op: "changed", a: 1, b: 2 },
  ]);
});

test("every block of both texts appears exactly once", () => {
  const before = ["a b c", "d e f", "g h i", "j k l"];
  const after = ["a b x", "new", "g h i", "j k l m", "tail"];
  const ops = alignBlocks(before, after);
  const as = ops.flatMap((o) => ("a" in o ? [o.a] : []));
  const bs = ops.flatMap((o) => ("b" in o ? [o.b] : []));
  assert.deepEqual(as, [0, 1, 2, 3]);
  assert.deepEqual(bs, [0, 1, 2, 3, 4]);
});

const plain = (parts: { value: string; added?: boolean; removed?: boolean }[]) =>
  parts.map(({ value, added, removed }) => ({ value, ...(added ? { added } : {}), ...(removed ? { removed } : {}) }));

test("wordDiff merges a run of changes into one removal and one addition", () => {
  assert.deepEqual(plain(wordDiff("with nothing but", "carrying only but")), [
    { value: "with nothing", removed: true },
    { value: "carrying only", added: true },
    { value: " but" },
  ]);
  const parts = wordDiff("The rain fell.", "The rain fell hard.");
  assert.equal(parts.filter((p) => !p.added).map((p) => p.value).join(""), "The rain fell.");
  assert.equal(parts.filter((p) => !p.removed).map((p) => p.value).join(""), "The rain fell hard.");
  assert.deepEqual(plain(wordDiff("same", "same")), [{ value: "same" }]);
});
