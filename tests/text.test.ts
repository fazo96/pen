import assert from "node:assert/strict";
import { test } from "node:test";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { roman, sectionsOf } from "../lib/outline.ts";
import { hasCurlyQuotes, straightenQuotes } from "../lib/quotes.ts";
import { pageCount, slugify, straightQuotes, titleOf, withTitle, wordCount } from "../lib/text.ts";

// Small text helpers (lib/text.ts), the outline (lib/outline.ts) and quote
// straightening (lib/quotes.ts). titleOf and newManuscript round-trips are in
// markdown.test.ts.

test("slugify makes ids from titles", () => {
  assert.equal(slugify("Mara’s Café: Part II!"), "maras-cafe-part-ii");
  assert.equal(slugify("  --  "), "");
  assert.equal(slugify("x".repeat(70)).length, 60);
  assert.ok(!slugify(`${"a".repeat(59)} b`).endsWith("-"));
});

test("wordCount counts words, not comments or punctuation", () => {
  assert.equal(wordCount("The rain—at last—fell. %% not this %% Mara's well-worn coat."), 8);
  assert.equal(wordCount("<!-- hidden --> one two"), 2);
  assert.equal(wordCount("  … — "), 0);
});

test("titleOf takes the H1, else the first line of text", () => {
  assert.equal(titleOf("%% note %%\n# The *Harbour*\n\ntext", "x"), "The Harbour");
  assert.equal(titleOf("---\n> Just a line", "x"), "Just a line");
  assert.equal(titleOf("", "Untitled"), "Untitled");
  assert.equal(titleOf("w ".repeat(50), "x").length, 58);
});

test("withTitle adds an H1 from the file name when the text has none", () => {
  assert.equal(withTitle("﻿# Own\n\ntext", "x.md"), "# Own\n\ntext");
  assert.equal(withTitle("%% c %%\n# Own", "x.md"), "%% c %%\n# Own");
  assert.equal(withTitle("\ntext", "Mara Voss.md"), "# Mara Voss\n\ntext");
  assert.equal(withTitle("text", ".md"), "# Untitled\n\ntext");
});

test("pageCount and straightQuotes", () => {
  assert.equal(pageCount(0), 0);
  assert.equal(pageCount(1), 1);
  assert.equal(pageCount(1000), 4);
  assert.equal(straightQuotes("“It’s ‘fine’,” she said."), "\"It's 'fine',\" she said.");
});

test("roman numerals", () => {
  assert.deepEqual([1, 4, 9, 14, 40, 90, 400, 1994].map(roman), ["I", "IV", "IX", "XIV", "XL", "XC", "CD", "MCMXCIV"]);
});

test("sectionsOf numbers parts and chapters and counts their words", () => {
  const md = [
    "# Book", //            1
    "",
    "## Arrival", //         3
    "",
    "### The *Harbour*", //  5
    "One two three.",
    "```",
    "# not a heading",
    "```",
    "### Rain", //          10
    "Four %% not counted %% five.",
    "## Departure", //      12
    "### Dawn ##", //       13
    "Six.",
  ].join("\n");
  const s = sectionsOf(md);
  assert.deepEqual(
    s.map(({ level, text, label, line, end }) => [level, text, label, line, end]),
    [
      [1, "Book", "", 1, 14],
      [2, "Arrival", "Part I", 3, 11],
      [3, "The Harbour", "Chapter 1", 5, 9],
      [3, "Rain", "Chapter 2", 10, 11],
      [2, "Departure", "Part II", 12, 14],
      [3, "Dawn", "Chapter 3", 13, 14],
    ],
  );
  assert.equal(s[3].words, 3); // "Rain", "Four", "five"
  assert.equal(s[5].words, 2);
});

test("sectionsOf numbers scenes within their chapter", () => {
  const md = [
    "# Book", //       1
    "#### Prologue", // 2
    "### One", //       3
    "#### Fog", //      4
    "Mist.",
    "#### Bells", //    6
    "Ding dong.",
    "### Two", //       8
    "#### Dawn", //     9
    "##### not a scene",
  ].join("\n");
  assert.deepEqual(
    sectionsOf(md).map(({ level, text, label, line, end, words }) => [level, text, label, line, end, words]),
    [
      [1, "Book", "", 1, 10, 13],
      [4, "Prologue", "Scene 1", 2, 2, 1],
      [3, "One", "Chapter 1", 3, 7, 6],
      [4, "Fog", "Scene 1.1", 4, 5, 2],
      [4, "Bells", "Scene 1.2", 6, 7, 3],
      [3, "Two", "Chapter 2", 8, 10, 5],
      [4, "Dawn", "Scene 2.1", 9, 10, 4],
    ],
  );
});

test("sectionsOf ignores headings inside comments", () => {
  const s = sectionsOf("# Book\n%%\n## Cut part\n%%\n## Kept\n");
  assert.deepEqual(
    s.map((x) => [x.text, x.line]),
    [
      ["Book", 1],
      ["Kept", 5],
    ],
  );
});

const schema = getSchema([StarterKit]);
const docOf = (...content: unknown[]) => schema.nodeFromJSON({ type: "doc", content });
const text = (t: string, marks?: { type: string }[]) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });

test("quotes are straightened everywhere but in code", () => {
  const doc = docOf(
    { type: "paragraph", content: [text("“Go,” "), text("she’s", [{ type: "bold" }]), text(" ‘code’", [{ type: "code" }])] },
    { type: "codeBlock", content: [text("print(“x”)")] },
  );
  assert.ok(hasCurlyQuotes(doc));
  const tr = straightenQuotes(EditorState.create({ doc }))!;
  assert.equal(tr.getMeta("addToHistory"), false);
  const out = tr.doc;
  assert.equal(out.child(0).textContent, "\"Go,\" she's ‘code’");
  assert.ok(out.child(0).child(1).marks.some((m) => m.type.name === "bold"), "marks are kept");
  assert.equal(out.child(1).textContent, "print(“x”)");
  assert.ok(!hasCurlyQuotes(out));
  assert.equal(straightenQuotes(EditorState.create({ doc: out })), null);
});
