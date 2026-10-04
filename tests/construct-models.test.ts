import assert from "node:assert/strict";
import { test } from "node:test";
import { modelRef, parseModel, sanitizeModelSettings } from "../lib/construct/models.ts";

// Which model Construct uses where (lib/construct/models.ts).

test("names a model with its agent", () => {
  assert.deepEqual(parseModel("pi:namyra/muse-glimmer-30b-q4"), { agent: "pi", model: "namyra/muse-glimmer-30b-q4" });
  assert.deepEqual(parseModel("claude:opus"), { agent: "claude", model: "opus" });
  assert.deepEqual(parseModel("pi"), { agent: "pi" });
  assert.deepEqual(parseModel(undefined), { agent: "claude" });
  assert.equal(modelRef("pi", "namyra/x"), "pi:namyra/x");
  assert.equal(modelRef("claude"), "claude");
});

test("keeps only the settings it knows", () => {
  assert.deepEqual(sanitizeModelSettings({ chat: "claude:opus", quick: "pi:namyra/gemma-4-e4b", transcribe: "", other: "x" }), {
    chat: "claude:opus",
    quick: "pi:namyra/gemma-4-e4b",
  });
  assert.deepEqual(sanitizeModelSettings({ chat: "Claude Opus", quick: 3 }), {});
  assert.deepEqual(sanitizeModelSettings(null), {});
});
