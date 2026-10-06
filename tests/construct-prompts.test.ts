import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentsText,
  agentsUpdate,
  bookAgents,
  describeContext,
  globalSystemPrompt,
  promptContextFrom,
  quickPrompt,
  quickQuestion,
  systemPrompt,
} from "../lib/construct/prompts.ts";

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

test("the AGENTS entry joins the system prompts as standing instructions", () => {
  for (const prompt of [systemPrompt, quickPrompt]) {
    assert.doesNotMatch(prompt("Book"), /standing instructions/);
    assert.doesNotMatch(prompt("Book", "  \n"), /standing instructions/, "a blank entry is no entry");
    assert.match(prompt("Book", "# AGENTS\n\nBritish spelling."), /standing instructions[\s\S]*theirs win:\n"""\n# AGENTS\n\nBritish spelling\.\n"""$/);
  }
  assert.match(systemPrompt("Book", "x".repeat(25_000)), /"""\nx{20000}\n""" \(cut short: read_codex_entry "agents" has the rest\)$/);
  assert.match(quickPrompt("Book", "x".repeat(25_000)), /x{20000}\n""" \(cut short\)$/);
});

test("a change to AGENTS mid-chat is sent as an update", () => {
  assert.equal(agentsUpdate("Be blunt."), '[The writer updated their standing instructions (Codex entry AGENTS). They now read, replacing what you had before:\n"""\nBe blunt.\n"""]');
  assert.match(agentsUpdate(null), /no longer apply/);
  assert.equal(agentsText(" \n "), null);
  assert.equal(agentsText(undefined), null);
});

test("the Global Codex: its entries named in a message's context, its own prompt", () => {
  assert.deepEqual(promptContextFrom({ entry: "style", global: true }), { entry: "style", global: true });
  assert.deepEqual(promptContextFrom({ global: true }), {}, "no entry, nothing global about it");
  assert.match(describeContext({ entry: "style", global: true }), /^\[The writer is looking at the Global Codex entry "style"\.\]$/);
  assert.doesNotMatch(globalSystemPrompt(), /read_manuscript|standing instructions/);
  assert.match(globalSystemPrompt("Be blunt."), /theirs win:\n"""\nBe blunt\.\n"""$/);
  assert.match(quickPrompt(null), /a passage of the writer's notes/);
});

test("a book's standing instructions are the Global Codex's AGENTS, then its own", () => {
  assert.equal(bookAgents(null, "  "), null);
  assert.equal(bookAgents("Every book.", undefined), "Every book.");
  assert.equal(bookAgents(" ", "This book."), "This book.");
  const both = bookAgents("Every book.", "This book.") ?? "";
  assert.ok(both.indexOf("Every book.") < both.indexOf("This book."), both);
  assert.match(both, /this book's own AGENTS, which wins/);
});
