import assert from "node:assert/strict";
import { test } from "node:test";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { CommentExtensions, listComments } from "../lib/comments.ts";

const extensions = [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), ...CommentExtensions];
const schema = getSchema(extensions);
const md = new MarkdownManager({ extensions });
const docOf = (markdown: string) => schema.nodeFromJSON(md.parse(markdown));

test("listComments finds block and inline comments, in order, where they are", () => {
  const doc = docOf("# One\n\n%% a block note %%\n\nShe left %% check this %% at dawn.\n\n<!-- html one -->");
  const list = listComments(doc);
  assert.deepEqual(
    list.map(({ text, inline, before, after }) => ({ text, inline, before, after })),
    [
      { text: "a block note", inline: false, before: "", after: "" },
      { text: "check this", inline: true, before: "She left ", after: " at dawn." },
      { text: "html one", inline: false, before: "", after: "" },
    ],
  );
  for (const c of list) assert.equal(doc.textBetween(c.from, c.to), c.text);
});

test("listComments keeps two inline comments in a paragraph apart", () => {
  const doc = docOf("A %% one %% and %% two %% end.");
  assert.deepEqual(
    listComments(doc).map((c) => c.text),
    ["one", "two"],
  );
});

test("listComments trims long context to whole words", () => {
  const long = "word ".repeat(30).trim();
  const [c] = listComments(docOf(`${long} %% note %% ${long}`));
  assert.ok(c.before.startsWith("…word"));
  assert.ok(c.after.endsWith("word…"));
  assert.ok(c.before.length <= 50 && c.after.length <= 50);
});

test("listComments finds nothing in plain prose", () => {
  assert.deepEqual(listComments(docOf("# Title\n\nJust prose.")), []);
});
