import assert from "node:assert/strict";
import { test } from "node:test";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { MAX_BLOCKS, passageAt } from "../lib/cadenceText.ts";
import { CommentExtensions } from "../lib/comments.ts";
import { textBlocks } from "../lib/grammarText.ts";
import { ipa } from "../lib/prosody/phones.ts";

const extensions = [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), ...CommentExtensions];
const schema = getSchema(extensions);
const md = new MarkdownManager({ extensions });
const docOf = (markdown: string) => schema.nodeFromJSON(md.parse(markdown));

const doc = docOf("# Title\n\nThe river ran. %%a note%%\n\n%%\nblock comment\n%%\n\nThe night was still.\n\nA third one.");
const [, river, night] = textBlocks(doc);

test("the passage is the paragraph at the cursor, comments left out", () => {
  const p = passageAt(doc, river.pos + 3, river.pos + 3)!;
  assert.equal(p.text, "The river ran.");
  assert.deepEqual([p.blocks, p.cut], [1, false]);
});

test("a selection's paragraphs are joined by blank lines, and offsets map back to the document", () => {
  const p = passageAt(doc, river.pos + 2, night.pos + 4)!;
  assert.equal(p.text, "The river ran.\n\nThe night was still.");
  const start = p.text.indexOf("night");
  const r = p.range(start, start + 5)!;
  assert.equal(doc.textBetween(r.from, r.to), "night");
  const r2 = p.range(4, 9)!;
  assert.equal(doc.textBetween(r2.from, r2.to), "river");
});

test("no passage where the cursor isn't in prose: a block comment", () => {
  let inComment = -1;
  doc.descendants((n, pos) => {
    if (n.type.name === "commentBlock") inComment = pos + 2;
  });
  assert.ok(inComment > 0);
  assert.equal(passageAt(doc, inComment, inComment), null);
});

test("a long selection is cut to MAX_BLOCKS paragraphs", () => {
  const long = docOf(Array.from({ length: MAX_BLOCKS + 2 }, (_, i) => `Paragraph ${i}.`).join("\n\n"));
  const p = passageAt(long, 1, long.content.size - 1)!;
  assert.deepEqual([p.blocks, p.cut], [MAX_BLOCKS, true]);
});

test("ipa reads phonemes the way a dictionary prints them", () => {
  assert.equal(ipa("S AY1 L AH0 N S".split(" ")), "ˈsaɪ.ləns");
  assert.equal(ipa("W EY1 S T OW2 N".split(" ")), "ˈweɪˌstoʊn");
  assert.equal(ipa("B IH0 N IY1 TH".split(" ")), "bɪˈniθ");
});
