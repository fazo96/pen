import assert from "node:assert/strict";
import { after, test } from "node:test";
import { effectiveRules, emptyConfig, type GrammarConfig } from "../lib/grammarConfig.ts";
import { lintInWorker, stopWorker } from "../lib/harperWorker.ts";

// The server's Harper worker (lib/harperWorker.ts), plain JavaScript run with
// eval: it answers with pen's flags, and follows the settings it's given.

const TEXTS = [
  "She walked accross the square. It were a cold morning.",
  "The Quellan market was loud, and the the merchant smiled.",
  "Nothing wrong with this sentence.",
];

after(() => stopWorker());

const settings = (c: GrammarConfig) => ({ dialect: c.dialect, rules: effectiveRules(c), words: c.words });

test("the worker flags spelling and grammar, with fixes", { timeout: 120_000 }, async () => {
  const [a, b, c] = await lintInWorker(TEXTS, settings(emptyConfig()));
  const typo = a.find((f) => f.problem === "accross");
  assert.ok(typo, "accross is flagged");
  assert.equal(typo.rule, "SpellCheck");
  assert.equal(TEXTS[0].slice(typo.start, typo.end), "accross");
  assert.ok(typo.suggestions.some((s) => s.kind === "replace" && s.text === "across"));
  assert.match(typo.hash, /^\d+$/);
  assert.ok(b.some((f) => f.rule === "RepeatedWords"));
  assert.ok(b.some((f) => f.problem === "Quellan"));
  assert.deepEqual(c, []);
  // In order through the text.
  for (const flags of [a, b]) assert.deepEqual(flags.map((f) => f.start), flags.map((f) => f.start).toSorted((x, y) => x - y));
});

test("…with a dictionary, another dialect and switched rules", { timeout: 120_000 }, async () => {
  const config: GrammarConfig = { ...emptyConfig(), dialect: "british", words: ["Quellan"], rules: { RepeatedWords: false } };
  const [, b] = await lintInWorker(TEXTS, settings(config));
  assert.ok(!b.some((f) => f.problem === "Quellan"), "dictionary words aren't flagged");
  assert.ok(!b.some((f) => f.rule === "RepeatedWords"), "rules switched off aren't run");
  const [colour] = await lintInWorker(["The color of the sky."], settings(config));
  assert.ok(colour.some((f) => f.problem === "color"), "British spelling");
});
