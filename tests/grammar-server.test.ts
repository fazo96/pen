import assert from "node:assert/strict";
import { after, test } from "node:test";
import { LocalLinter } from "harper.js";
import { binaryInlined } from "harper.js/binaryInlined";
import { effectiveRules, emptyConfig, type GrammarConfig } from "../lib/grammarConfig.ts";
import { lintInWorker, stopWorker } from "../lib/construct/harperWorker.ts";
import { configure, lintFlags } from "../lib/harperFlags.ts";

// The server's Harper worker is plain JavaScript that repeats lib/harperFlags.ts
// (what the browser's worker uses): they must flag the same things.

const TEXTS = [
  "She walked accross the square. It were a cold morning.",
  "The Quellan market was loud, and the the merchant smiled.",
  "He said it was definately the best bread on Quellan.",
  "Nothing wrong with this sentence.",
];

after(() => stopWorker());

async function both(config: GrammarConfig) {
  const settings = { dialect: config.dialect, rules: effectiveRules(config), words: config.words };
  const linter = new LocalLinter({ binary: binaryInlined });
  await configure(linter, settings.dialect, settings.rules, settings.words);
  const browser = [];
  for (const t of TEXTS) browser.push(await lintFlags(linter, t));
  const server = await lintInWorker(TEXTS, settings);
  return { browser, server };
}

test("the server's worker flags the same as the browser's", { timeout: 120_000 }, async () => {
  const { browser, server } = await both(emptyConfig());
  assert.ok(browser.flat().length >= 4, "the sample has flags to compare");
  assert.deepEqual(server, browser);
});

test("…with a dictionary, another dialect and switched rules too", { timeout: 120_000 }, async () => {
  const config: GrammarConfig = { ...emptyConfig(), dialect: "british", words: ["Quellan"], rules: { RepeatedWords: false } };
  const { browser, server } = await both(config);
  assert.ok(!server.flat().some((f) => f.problem === "Quellan"), "dictionary words aren't flagged");
  assert.deepEqual(server, browser);
});
