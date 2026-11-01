import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { explainPrompt, rewritePrompt, rewritesIn } from "../lib/cadenceAsk.ts";
import { compactCmu } from "../lib/cmudictBuild.ts";
import { quickPrompt } from "../lib/construct/prompts.ts";
import { analyze, parseCompact } from "../lib/prosody/index.ts";
import { passageReport } from "../lib/prosody/report.ts";

const table = parseCompact(compactCmu(readFileSync(new URL("./fixtures/cmudict-mini.dict", import.meta.url), "utf8")));
const dict = { lookup: (k: string) => table.get(k), own: {} };

test("rewritesIn reads numbered rewrites and their notes, whatever the model's markup", () => {
  const answer = [
    "1. The river ran beneath the stone. — drops a light syllable",
    "2) **The broken stone lay under the river.** – falling now",
    '3. "Beneath the broken stone, the river ran."',
    "4. A fourth one is one too many.",
    "Some closing remark.",
  ].join("\n");
  assert.deepEqual(rewritesIn(answer), [
    { text: "The river ran beneath the stone.", note: "drops a light syllable" },
    { text: "The broken stone lay under the river.", note: "falling now" },
    { text: "Beneath the broken stone, the river ran.", note: "" },
  ]);
  assert.deepEqual(rewritesIn("No list here."), []);
  assert.deepEqual(rewritesIn("1. Half-forgotten, the river ran - it went on"), [{ text: "Half-forgotten, the river ran", note: "it went on" }], "a hyphen inside a word stays");
});

test("the questions carry Cadence's reading, and say who the writer is", () => {
  const text = "The river ran beneath the broken stone.";
  const report = passageReport("The sentence", text, analyze(text, dict));
  assert.match(report, /^The sentence · 1 sentence, 10 syllables\nThe\(x\) river\(\/x\)/);
  const rewrite = rewritePrompt(text, report);
  assert.ok(rewrite.includes(report));
  assert.match(rewrite, /the writer asked for rewrites/);
  assert.match(rewrite, /up to 3 rewrites/);
  assert.match(explainPrompt(report), /don't rewrite anything/);
  assert.match(quickPrompt("Book"), /don't rewrite their sentences unless the question asks for rewrites/);
});
