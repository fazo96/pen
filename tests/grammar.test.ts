import assert from "node:assert/strict";
import { test } from "node:test";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { CommentExtensions } from "../lib/comments.ts";
import {
  applyPatch,
  dictKey,
  emptyConfig,
  ruleLabel,
  ruleOn,
  sanitizeConfig,
  sanitizePatch,
  visibleFlags,
} from "../lib/grammarConfig.ts";
import { flagRange, textBlocks, type Flag } from "../lib/grammarText.ts";

const extensions = [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), ...CommentExtensions];
const schema = getSchema(extensions);
const md = new MarkdownManager({ extensions });
const docOf = (markdown: string) => schema.nodeFromJSON(md.parse(markdown));

const flag = (over: Partial<Flag>): Flag => ({
  start: 0,
  end: 1,
  rule: "SpellCheck",
  kind: "Spelling",
  message: "",
  problem: "",
  suggestions: [],
  hash: "1",
  ...over,
});

/** The document text a flag's range covers. */
function flagged(markdown: string, word: string): string | null {
  const doc = docOf(markdown);
  for (const b of textBlocks(doc)) {
    const start = b.text.indexOf(word);
    if (start < 0) continue;
    const r = flagRange(b, flag({ start, end: start + word.length }));
    return r && doc.textBetween(r.from, r.to);
  }
  return null;
}

test("textBlocks reads prose and leaves comments, code and empty blocks out", () => {
  const doc = docOf(
    [
      "# Title",
      "",
      "She froze. %% a note %% Then ran.",
      "",
      "%% a block comment %%",
      "",
      "```",
      "code here",
      "```",
      "",
      "Use `grep` now.",
      "",
      "---",
      "",
      "> Quoted words.",
    ].join("\n"),
  );
  assert.deepEqual(
    textBlocks(doc).map((b) => b.text),
    ["Title", "She froze. Then ran.", "Use now.", "Quoted words."],
  );
});

test("a left-out run between words reads as one space", () => {
  const [b] = textBlocks(docOf("one%%x%%two"));
  assert.equal(b.text, "one two");
});

test("flags land on the words they name, around comments and marks", () => {
  assert.equal(flagged("She said teh word.", "teh"), "teh");
  assert.equal(flagged("A *very* bad %% note %% sentense here.", "sentense"), "sentense");
  assert.equal(flagged("Line one  \nand teh next.", "teh"), "teh");
});

test("a flag spanning a left-out comment is dropped", () => {
  const [b] = textBlocks(docOf("one %% x %% two"));
  assert.equal(b.text, "one two");
  assert.equal(flagRange(b, flag({ start: 0, end: 7 })), null);
});

test("sanitizeConfig drops malformed entries, duplicates, and switches equal to the default", () => {
  const c = sanitizeConfig({
    dialect: "klingon",
    words: ["Bioscan", "bioscan", "two words", "", 3, "Aethelgard"],
    rules: { OxfordComma: false, SpellCheck: true, LongSentences: true, "bad name": false, Dashes: "no" },
    ignored: ["123", "123", "abc"],
  });
  assert.deepEqual(c, {
    dialect: "american",
    words: ["Bioscan", "Aethelgard"],
    rules: { LongSentences: true },
    ignored: ["123"],
  });
});

test("patches add and remove words, switch rules and reset them", () => {
  let c = emptyConfig();
  c = applyPatch(c, sanitizePatch({ addWord: " Bioscan's " })!);
  assert.deepEqual(c.words, ["Bioscan's"]);
  c = applyPatch(c, sanitizePatch({ removeWord: "BIOSCAN" })!);
  assert.deepEqual(c.words, []);
  c = applyPatch(c, sanitizePatch({ rule: { name: "OxfordComma", on: true } })!);
  assert.equal(ruleOn(c, "OxfordComma"), true);
  c = applyPatch(c, sanitizePatch({ rule: { name: "OxfordComma", on: null } })!);
  assert.equal(ruleOn(c, "OxfordComma"), false);
  assert.equal(ruleOn(c, "SpellCheck"), true);
  c = applyPatch(c, sanitizePatch({ ignore: "42", dialect: "british" })!);
  assert.deepEqual([c.dialect, c.ignored], ["british", ["42"]]);
  assert.deepEqual(applyPatch(c, { clearIgnored: true }).ignored, []);
  assert.equal(sanitizePatch({ addWord: "two words" }), null);
  assert.equal(sanitizePatch({ rule: { name: "x y", on: true } }), null);
});

test("the dictionary ignores case and possessives; rule switches and ignores filter flags", () => {
  const c = { ...emptyConfig(), words: ["Bioscan"] };
  const dict = new Set(c.words.map(dictKey));
  const flags = [
    flag({ problem: "BIOSCAN", hash: "1" }),
    flag({ problem: "Bioscan’s", hash: "2" }),
    flag({ problem: "teh", hash: "3" }),
    flag({ rule: "OxfordComma", kind: "Style", hash: "4" }),
    flag({ rule: "Dashes", kind: "Formatting", hash: "5" }),
    flag({ rule: "Dashes", kind: "Formatting", hash: "6" }),
  ];
  assert.deepEqual(
    visibleFlags(flags, c, dict, new Set(["6"])).map((f) => f.hash),
    ["3", "5"],
  );
});

test("ruleLabel spells out Harper's rule names", () => {
  assert.equal(ruleLabel("OxfordComma"), "Oxford comma");
  assert.equal(ruleLabel("UseEllipsisCharacter"), "Use ellipsis character");
  assert.equal(ruleLabel("AnA"), "An a");
});
