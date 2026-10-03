import assert from "node:assert/strict";
import { test } from "node:test";
import { keyLabel, shortcutList, withKeys } from "../lib/shortcuts.ts";

test("spells shortcuts out with Ctrl elsewhere", () => {
  assert.equal(keyLabel("switch", false), "Ctrl+Shift+E");
  assert.equal(keyLabel("h2", false), "Ctrl+Alt+2");
  assert.equal(keyLabel("bold", false), "Ctrl+B");
});

test("uses Apple's symbols and order on a Mac", () => {
  assert.equal(keyLabel("switch", true), "⇧⌘E");
  assert.equal(keyLabel("h2", true), "⌥⌘2");
  assert.equal(keyLabel("goTo", true), "⌘O");
});

test("lists them by group, with keys for the same thing on one row", () => {
  const go = shortcutList(false).find((g) => g.group === "Go")!;
  assert.deepEqual(go.rows.find((r) => r.what === "Commands")?.keys, ["Ctrl+K", "Ctrl+P"]);
  assert.deepEqual(
    shortcutList(false).map((g) => g.group),
    ["Go", "Write", "Format"],
  );
});

test("adds the keys to a tooltip", () => {
  assert.equal(withKeys("Construct", "construct", false), "Construct (Ctrl+Shift+A)");
});
