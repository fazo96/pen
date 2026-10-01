import assert from "node:assert/strict";
import { test } from "node:test";
import { match, pieces, rank } from "../lib/palette.ts";

const labels = (xs: { item: { label: string } }[]) => xs.map((x) => x.item.label);

test("matches runs, word starts and scattered letters", () => {
  assert.deepEqual(match("storm", "The Storm")?.hits, [4, 5, 6, 7, 8]);
  assert.deepEqual(match("nc", "New chat")?.hits, [0, 4]);
  assert.equal(match("xyz", "New chat"), null);
  assert.deepEqual(match("", "anything"), { score: 0, hits: [] });
});

test("ignores case and accents, keeping hit positions", () => {
  assert.deepEqual(match("cafe", "Le Café")?.hits, [3, 4, 5, 6]);
});

test("every word must match, in any order", () => {
  assert.ok(match("storm 12", "12 The storm"));
  assert.equal(match("storm 13", "12 The storm"), null);
});

test("ranks runs at word starts over scattered matches", () => {
  const items = [{ label: "Grammar settings" }, { label: "Save version…" }, { label: "Show grammar flags" }];
  assert.deepEqual(labels(rank(items, "gram")), ["Grammar settings", "Show grammar flags"]);
  assert.deepEqual(labels(rank(items, "sv")), ["Save version…"]);
  assert.deepEqual(labels(rank(items, "sg")), ["Show grammar flags", "Grammar settings"]);
});

test("equal scores keep the given order", () => {
  const items = [{ label: "Mira" }, { label: "Mira" }].map((x, i) => ({ ...x, id: i }));
  assert.deepEqual(
    rank(items, "mira").map((x) => x.item.id),
    [0, 1],
  );
});

test("keywords match more weakly than the label, without hits", () => {
  const items = [{ label: "Toggle Construct", keywords: "ai chat" }, { label: "New chat" }];
  const r = rank(items, "chat");
  assert.deepEqual(labels(r), ["New chat", "Toggle Construct"]);
  assert.deepEqual(r[1].hits, []);
});

test("pieces split the label at the hits", () => {
  assert.deepEqual(pieces("abc", [1]), [
    { text: "a", hit: false },
    { text: "b", hit: true },
    { text: "c", hit: false },
  ]);
});
