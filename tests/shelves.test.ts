import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addShelf,
  arrange,
  findBook,
  followRenames,
  moveBook,
  moveShelf,
  removeShelf,
  renameBook,
  renameShelf,
  sanitize,
  type Layout,
} from "../lib/shelfLayout.ts";

const layout = (...shelves: [string, string, string[]][]): Layout => ({
  shelves: shelves.map(([id, name, books]) => ({ id, name, books })),
});

test("without a layout every book is on one unnamed shelf, in the given order", () => {
  assert.deepEqual(arrange(null, ["c", "a", "b"]), layout(["main", "", ["c", "a", "b"]]));
});

test("arrange drops gone and duplicate books and puts new ones first on the first shelf", () => {
  const saved = layout(["one", "Series", ["a", "gone", "b"]], ["two", "Shorts", ["b", "c"]]);
  assert.deepEqual(arrange(saved, ["new", "c", "b", "a"]), layout(["one", "Series", ["new", "a", "b"]], ["two", "Shorts", ["c"]]));
});

test("arrange keeps empty shelves", () => {
  const saved = layout(["one", "", ["a"]], ["two", "Empty", []]);
  assert.deepEqual(arrange(saved, ["a"]), saved);
});

test("moveBook reorders within a shelf and moves across shelves", () => {
  const l = layout(["one", "", ["a", "b", "c"]], ["two", "", ["d"]]);
  assert.deepEqual(moveBook(l, "a", "one", 2).shelves[0].books, ["b", "c", "a"]);
  assert.deepEqual(moveBook(l, "c", "one", 0).shelves[0].books, ["c", "a", "b"]);
  const across = moveBook(l, "b", "two", 0);
  assert.deepEqual(across.shelves.map((s) => s.books), [["a", "c"], ["b", "d"]]);
  assert.deepEqual(moveBook(l, "b", "two", 99).shelves[1].books, ["d", "b"]);
  assert.equal(moveBook(l, "b", "nowhere", 0), l);
  assert.deepEqual(findBook(across, "b"), { shelf: "two", index: 0 });
  assert.equal(findBook(across, "zzz"), null);
});

test("shelves can be added, renamed, moved and removed", () => {
  let l = layout(["one", "", ["a"]]);
  l = addShelf(l, "two", "  The   Series ");
  assert.equal(l.shelves[1].name, "The Series");
  l = renameShelf(l, "one", "Shorts");
  l = moveBook(l, "a", "two", 0);
  l = moveShelf(l, "two", -1);
  assert.deepEqual(l, layout(["two", "The Series", ["a"]], ["one", "Shorts", []]));
  assert.equal(moveShelf(l, "two", -1), l);
  l = addShelf(l, "three");
  l = moveBook(l, "a", "three", 0);
  l = removeShelf(l, "three");
  assert.deepEqual(l, layout(["two", "The Series", ["a"]], ["one", "Shorts", []]));
  l = removeShelf(l, "two");
  assert.deepEqual(l, layout(["one", "Shorts", ["a"]]));
  assert.equal(removeShelf(l, "one"), l, "the last shelf stays");
});

test("sanitize accepts layouts and rejects malformed ones", () => {
  const ok = layout(["one", "Name", ["a-b", "c"]]);
  assert.deepEqual(sanitize(ok), ok);
  assert.equal(sanitize(null), null);
  assert.equal(sanitize({}), null);
  assert.equal(sanitize({ shelves: [{ id: "one", name: 3, books: [] }] }), null);
  assert.equal(sanitize({ shelves: [{ id: "../x", name: "", books: [] }] }), null);
  assert.equal(sanitize({ shelves: [{ id: "one", name: "", books: ["../etc"] }] }), null);
  assert.equal(sanitize(layout(["one", "", []], ["one", "", []])), null);
  assert.equal(sanitize({ shelves: [{ id: "one", name: "x".repeat(200), books: [] }] })!.shelves[0].name.length, 80);
});

test("renameBook keeps a book in its place", () => {
  const l = layout(["one", "", ["a", "b"]], ["two", "", ["c"]]);
  assert.deepEqual(renameBook(l, "b", "z"), layout(["one", "", ["a", "z"]], ["two", "", ["c"]]));
});

test("followRenames puts renamed books back under their new ids", () => {
  const stale = layout(["one", "", ["a", "old"]], ["two", "", ["c"]]);
  const exists = new Set(["a", "new", "c"]);
  const followed = followRenames(stale, { old: "new" }, exists);
  assert.deepEqual(followed, layout(["one", "", ["a", "new"]], ["two", "", ["c"]]));
  // Arranged, it stays where it was instead of going first as an unknown book.
  assert.deepEqual(arrange(followed, ["new", "a", "c"]), followed);
  // An old id that names a book again is that book.
  assert.deepEqual(followRenames(stale, { old: "new" }, new Set([...exists, "old"])), stale);
});
