import assert from "node:assert/strict";
import { test } from "node:test";
import { alternativesIn, matchCase } from "../lib/wordTools.ts";

// Construct's quick answers: the synonyms offered become buttons (lib/wordTools.ts).

test("finds the words offered in a Synonyms answer", () => {
  const answer = [
    "- **stroll** — slower, at ease",
    "- amble: unhurried, a little aimless",
    "1. trudge (heavy, tired)",
    "2. *pace* – back and forth",
    "wander, with no aim",
    "",
    "Most of these change the mood of the scene, so pick by how she feels.",
  ].join("\n");
  assert.deepEqual(alternativesIn(answer), ["stroll", "amble", "trudge", "pace", "wander"]);
});

test("keeps short phrases and skips duplicates", () => {
  assert.deepEqual(alternativesIn("- set off — a start\n- set off — again\n- make one's way — longer"), ["set off", "make one's way"]);
});

test("gives a replacement the case of the word it replaces", () => {
  assert.equal(matchCase("stroll", "walk"), "stroll");
  assert.equal(matchCase("stroll", "Walk"), "Stroll");
  assert.equal(matchCase("stroll", "WALK"), "STROLL");
  assert.equal(matchCase("stroll", "I"), "Stroll");
});
