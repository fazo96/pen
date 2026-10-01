import assert from "node:assert/strict";
import { test } from "node:test";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Marked } from "marked";
import { CommentExtensions } from "../lib/comments.ts";
import { pickedWords } from "../lib/wordTools.ts";
import { baseCandidates, endingOf, inflectLike } from "../lib/wordforms.ts";

const bases = (w: string) => baseCandidates(w).map((c) => c.base);

test("baseCandidates tries the word, then WordNet's suffix rules", () => {
  assert.deepEqual(bases("Walked").slice(0, 1), ["walked"]);
  assert.ok(bases("walked").includes("walk"));
  assert.ok(bases("stopped").includes("stop"), "doubled consonant");
  assert.ok(bases("running").includes("run"));
  assert.ok(bases("ponies").includes("pony"));
  assert.ok(bases("churches").includes("church"));
  assert.ok(bases("hoped").includes("hope"));
  assert.ok(bases("bigger").includes("big"));
  assert.ok(bases("women").includes("woman"));
  assert.deepEqual(bases("Vorlith's"), ["vorlith"], "possessive dropped");
  assert.deepEqual(bases("base on balls"), ["base on balls"], "phrases are taken as they are");
});

test("endingOf finds the regular ending, or none", () => {
  assert.equal(endingOf("walked", "walk"), "ed");
  assert.equal(endingOf("stopping", "stop"), "ing");
  assert.equal(endingOf("hoped", "hope"), "ed");
  assert.equal(endingOf("tries", "try"), "s");
  assert.equal(endingOf("walk", "walk"), "");
  assert.equal(endingOf("went", "go"), null);
});

test("inflectLike gives a synonym the replaced word's form and case", () => {
  assert.equal(inflectLike("stroll", "walk", "walked", "v"), "strolled");
  assert.equal(inflectLike("amble", "walk", "walking", "v"), "ambling");
  assert.equal(inflectLike("trot", "walk", "walking", "v"), "trotting");
  assert.equal(inflectLike("hurry", "walk", "walks", "v"), "hurries");
  assert.equal(inflectLike("stroll", "walk", "Walked", "v"), "Strolled");
  assert.equal(inflectLike("stroll", "walk", "WALKED", "v"), "STROLLED");
  assert.equal(inflectLike("walk about", "walk", "walked", "v"), "walked about", "verbs inflect their first word");
  assert.equal(inflectLike("house cat", "cat", "cats", "n"), "house cats", "nouns their last");
  assert.equal(inflectLike("sorrow", "melancholy", "melancholy", "n"), "sorrow");
  assert.equal(inflectLike("vessel", "ship", "ship's", "n"), "vessel's");
  assert.equal(inflectLike("depart", "go", "went", "v"), null, "irregular forms aren't carried over");
  assert.equal(inflectLike("take the air", "walk", "walked", "v", true), null, "nor given to an irregular verb");
  assert.equal(inflectLike("take the air", "walk", "walking", "v", true), "taking the air", "whose -ing is regular");
  assert.equal(inflectLike("mouse", "rat", "rats", "n", true), null);
});

const extensions = [StarterKit, ...CommentExtensions];
const schema = getSchema(extensions);
const md = new MarkdownManager({ marked: new Marked() as never, extensions });

function stateWith(markdown: string, word: string, from = 0): EditorState {
  const doc = schema.nodeFromJSON(md.parse(markdown));
  let at = -1;
  doc.descendants((node, pos) => {
    if (at >= 0 || !node.isText) return;
    const i = node.text!.indexOf(word, from);
    if (i >= 0) at = pos + i;
  });
  const state = EditorState.create({ doc });
  return state.apply(state.tr.setSelection(TextSelection.create(doc, at, at + word.length)));
}

test("pickedWords takes a word or short phrase, trimmed, with its paragraph", () => {
  const p = pickedWords(stateWith("She walked slowly, alone.", " slowly, "));
  assert.equal(p?.text, "slowly");
  assert.equal(p?.paragraph, "She walked slowly, alone.");
  assert.equal(pickedWords(stateWith("One two three four five six.", "One two three four five"))?.text, undefined);
  assert.equal(pickedWords(stateWith("%% a note here %%", "note")), null, "not in comments");
  assert.equal(pickedWords(stateWith("Quiet... ...", "... ...")), null, "needs a letter");
});
