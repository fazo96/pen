import assert from "node:assert/strict";
import { test } from "node:test";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { CommentExtensions } from "../lib/comments.ts";
import { findBlocks, type FindOptions, matchFrom, MAX_MATCHES, search } from "../lib/find.ts";

const extensions = [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), ...CommentExtensions];
const schema = getSchema(extensions);
const md = new MarkdownManager({ extensions });
const docOf = (markdown: string) => schema.nodeFromJSON(md.parse(markdown));

const plain: FindOptions = { caseSensitive: false, wholeWord: false };
/** What each match covers in the document. */
const found = (markdown: string, query: string, options = plain) => {
  const doc = docOf(markdown);
  return search(findBlocks(doc), query, options).map((m) => doc.textBetween(m.from, m.to));
};

test("ignores case unless asked, and accents always", () => {
  assert.deepEqual(found("The Storm, the storm.", "storm"), ["Storm", "storm"]);
  assert.deepEqual(found("The Storm, the storm.", "Storm", { ...plain, caseSensitive: true }), ["Storm"]);
  assert.deepEqual(found("Le café, the cafe.", "cafe"), ["café", "cafe"]);
});

test("runs across bold and italic", () => {
  assert.deepEqual(found("a **dark** and *stormy* night", "dark and stormy"), ["dark and stormy"]);
});

test("finds whole words only when asked", () => {
  assert.deepEqual(found("rain, rainy, train", "rain").length, 3);
  assert.deepEqual(found("rain, rainy, train", "rain", { ...plain, wholeWord: true }), ["rain"]);
});

test("ellipses, dashes, quotes and spaces find their other spellings", () => {
  assert.deepEqual(found("Wait… no. Wait... yes.", "wait..."), ["Wait…", "Wait..."]);
  assert.deepEqual(found("Wait… no. Wait... yes.", "wait…"), ["Wait…", "Wait..."]);
  assert.deepEqual(found("then—now, then--later", "then--"), ["then—", "then--"]);
  assert.deepEqual(found("It's here", "It’s"), ["It's"]);
  assert.deepEqual(found("two  spaces", "two spaces"), ["two  spaces"]);
});

test("searches comments and headings, never across paragraphs", () => {
  assert.deepEqual(found("# Storm\n\nText %% storm note %%", "storm"), ["Storm", "storm"]);
  assert.deepEqual(found("%%\nstorm block\n%%", "storm"), ["storm"]);
  assert.deepEqual(found("end of one\n\nstart of two", "one start"), []);
});

test("an empty query finds nothing; regex characters are plain", () => {
  assert.deepEqual(found("anything", "  "), []);
  assert.deepEqual(found("a (b) c.d", "(b) c."), ["(b) c."]);
  assert.deepEqual(found("a (b) c.d", "c.d"), ["c.d"]);
  assert.deepEqual(found("acxd", "c.d"), []);
});

test("stops one past the limit, so the bar can say there are more", () => {
  const doc = docOf("a ".repeat(MAX_MATCHES + 50));
  assert.equal(search(findBlocks(doc), "a", plain).length, MAX_MATCHES + 1);
  assert.equal(search(findBlocks(doc), "a", plain, Infinity).length, MAX_MATCHES + 50);
});

test("the first match at or after the cursor, wrapping round", () => {
  const ms = [
    { from: 5, to: 8 },
    { from: 20, to: 23 },
  ];
  assert.equal(matchFrom(ms, 0), 0);
  assert.equal(matchFrom(ms, 6), 1);
  assert.equal(matchFrom(ms, 30), 0);
  assert.equal(matchFrom([], 0), -1);
});
