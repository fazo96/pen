import assert from "node:assert/strict";
import { test } from "node:test";
import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { CommentExtensions } from "../lib/comments.ts";
import { escapeText, installEscaping } from "../lib/markdownEscape.ts";
import { newManuscript, titleOf } from "../lib/text.ts";

// The editor's markdown, minus the DOM: tiptap's own manager with pen's extensions.
function manager() {
  const m = new MarkdownManager({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), ...CommentExtensions],
  });
  installEscaping(m);
  return m;
}
const md = manager();

const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
const para = (...content: (string | JSONContent)[]): JSONContent => ({
  type: "paragraph",
  content: content.map((c) => (typeof c === "string" ? { type: "text", text: c } : c)),
});
const br: JSONContent = { type: "hardBreak" };

/** Serialize, parse back, and require the same document. Returns the markdown. */
function roundTrip(json: JSONContent): string {
  const out = md.serialize(json);
  const clean = (j: JSONContent) => JSON.parse(JSON.stringify(j)) as JSONContent;
  assert.deepEqual(clean(md.parse(out)), clean(md.parse(md.serialize(md.parse(out)))), "not stable");
  assert.deepEqual(clean(md.parse(out)), json, `changed on reload:\n${out}`);
  return out;
}

test("escapeText guards block starts only at the start of a line", () => {
  assert.equal(escapeText("- Who's there?", true), "\\- Who's there?");
  assert.equal(escapeText("- Who's there?", false), "- Who's there?");
  assert.equal(escapeText("2. Not sure", true), "2\\. Not sure");
  assert.equal(escapeText("2) Not sure", true), "2\\) Not sure");
  assert.equal(escapeText("# Summary", true), "\\# Summary");
  assert.equal(escapeText("### x", true), "\\### x");
  assert.equal(escapeText("> quoted", true), "\\> quoted");
  assert.equal(escapeText(">no space", true), "\\>no space");
  assert.equal(escapeText("+ plus", true), "\\+ plus");
  assert.equal(escapeText("---", true), "\\---");
  assert.equal(escapeText("===", true), "\\===");
  assert.equal(escapeText("  - indented", true), "  \\- indented");
  assert.equal(escapeText("a\n- b", false), "a\n\\- b");
});

test("escapeText leaves harmless text readable", () => {
  for (const s of ["-foo", "1.Yes", "#hashtag", "1999 was a year", "— an em dash", "=x", "a > b", "5 + 3"]) {
    assert.equal(escapeText(s, true), s);
  }
  assert.equal(escapeText("Fish & chips, 3 < 4 > 2", true), "Fish & chips, 3 < 4 > 2");
});

test("escapeText escapes inline syntax, entities, HTML and pen comments", () => {
  assert.equal(escapeText("*a* _b_ `c` [d] ~e~ \\f", false), "\\*a\\* \\_b\\_ \\`c\\` \\[d\\] \\~e\\~ \\\\f");
  assert.equal(escapeText("&amp; and &#39;", false), "&amp;amp; and &amp;#39;");
  assert.equal(escapeText("<div> </p> <!-- x --> <?php", false), "\\<div> \\</p> \\<!-- x --> \\<?php");
  assert.equal(escapeText("50%% off %%%", false), "50%\\% off %\\%\\%");
});

test("paragraphs that look like blocks stay paragraphs", () => {
  for (const text of ["- Who's there? he called.", "+ plus", "2. Not sure about the ending.", "1) first", "# Summary", "> not a quote", "---", "==="]) {
    roundTrip(doc(para(text)));
  }
});

test("line starts after a hard break are guarded too", () => {
  const out = roundTrip(doc(para("She said:", br, "- Go.", br, "3. Run.")));
  assert.match(out, /^\\- Go\. *$/m);
  assert.match(out, /^3\\\. Run\.$/m);
});

test("paragraphs inside quotes and lists keep their text", () => {
  roundTrip(doc({ type: "blockquote", content: [para("- Who's there?")] }));
  roundTrip(
    doc({
      type: "bulletList",
      content: [{ type: "listItem", content: [para("1. not nested")] }],
    }),
  );
});

test("text is written plainly where markdown allows", () => {
  assert.equal(roundTrip(doc(para("Fish & chips, 3 < 4 > 2."))), "Fish & chips, 3 < 4 > 2.");
  assert.equal(roundTrip(doc(para("I'd keep it <short>."))), "I'd keep it \\<short>.");
  roundTrip(doc(para("&amp; is how you write &, and <!-- is not a comment here")));
  roundTrip(doc(para("50%% of this %% is not a comment")));
});

test("marks and code are unaffected", () => {
  const bold = { type: "text", text: "- bold", marks: [{ type: "bold" }] };
  roundTrip(doc(para(bold, " start")));
  const code = { type: "text", text: "- x & <y> %% z", marks: [{ type: "code" }] };
  assert.equal(roundTrip(doc(para(code))), "`- x & <y> %% z`");
  roundTrip(doc({ type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text: "- a\n# b\n&amp;" }] }));
});

test("existing files load and save unchanged", () => {
  const file = [
    "# The Title",
    "## I",
    "### 1",
    "It was *late*, and **cold**. Fish & chips.",
    "> A quote.",
    "- one\n- two",
    "1. first\n2. second",
    "%% a note %%",
    "Text with %% an inline note %% inside.",
    "<!-- html note -->",
    "\\- Who's there?",
    "2\\. Not sure",
    "Line one  \nline two",
    "`code` and a [link](https://example.com)",
    "---",
    "The end.",
  ].join("\n\n");
  assert.equal(md.serialize(md.parse(file)), file);
});

test("installEscaping refuses a manager without the expected internals", () => {
  assert.throws(() => installEscaping({} as MarkdownManager), /internals changed/);
});

test("a new manuscript's title reads back as typed, in the editor and the library", () => {
  const titles = ["The *Heist*", "Part #", "snake_case & <b>bold</b>", "100%% sure", "# Hash", "[Not] a link", "C:\\path", "Fish &amp; chips"];
  for (const t of titles) {
    const source = newManuscript(t);
    const heading = md.parse(source).content?.[0];
    assert.equal(heading?.type, "heading", source);
    assert.equal(heading?.content?.map((c) => c.text).join(""), t, source);
    assert.equal(titleOf(source, "x"), t, source);
  }
  assert.equal(newManuscript("  Tom’s   “Tale” "), "# Tom's \"Tale\"\n\n");
  assert.equal(newManuscript("  "), "# Untitled\n\n");
});

test("titles keep their closing hashes only when escaped", () => {
  assert.equal(titleOf("# Title ##\n", "x"), "Title");
  assert.equal(titleOf("# C#\n", "x"), "C#");
});
