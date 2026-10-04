import assert from "node:assert/strict";
import { test } from "node:test";
import { describeContext, promptContextFrom, quickQuestion } from "../lib/construct/prompts.ts";

// What Construct is told along with a message (lib/construct/prompts.ts).

test("a message's context is checked and trimmed to size", () => {
  assert.deepEqual(promptContextFrom({ entry: "mara", selection: "rain", paragraph: "The rain fell." }), {
    entry: "mara",
    selection: "rain",
    paragraph: "The rain fell.",
  });
  assert.deepEqual(promptContextFrom({ entry: "../etc", selection: "   ", paragraph: 3 }), {});
  assert.deepEqual(promptContextFrom(null), {});
  assert.equal(promptContextFrom({ selection: "x".repeat(5000) }).selection?.length, 4000);
  assert.equal(promptContextFrom({ paragraph: "x".repeat(9000) }).paragraph?.length, 8000);
});

test("a chat message says where the writer is and quotes the selection and its paragraph", () => {
  assert.equal(describeContext({}), "[The writer is looking at the manuscript.]");
  const text = describeContext({ entry: "mara", selection: "rain", paragraph: "The rain fell." });
  assert.match(text, /^\[The writer is looking at the Codex entry "mara"\. The writer selected this text:\n"""\nrain\n"""/);
  assert.match(text, /It's in this paragraph \(search for it to find its line\):\n"""\nThe rain fell\.\n"""\]$/);
  // A whole paragraph selected isn't quoted twice.
  assert.doesNotMatch(describeContext({ selection: "The rain fell.", paragraph: " The rain fell. " }), /paragraph/);
});

test("a quick question carries its passage, with nothing to search", () => {
  assert.equal(quickQuestion("Synonyms?", {}), "Synonyms?");
  const q = quickQuestion("Synonyms?", { selection: "rain", paragraph: "The rain fell." });
  assert.equal(q, `The writer selected this text:\n"""\nrain\n"""\n\nIt's in this paragraph:\n"""\nThe rain fell.\n"""\n\nSynonyms?`);
});
