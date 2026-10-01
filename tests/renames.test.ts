import assert from "node:assert/strict";
import { test } from "node:test";
import { withRename } from "../lib/renameMap.ts";

test("a rename is recorded", () => {
  assert.deepEqual(withRename({}, "a", "b"), { a: "b" });
});

test("older ids follow a book through later renames", () => {
  let m = withRename({}, "a", "b");
  m = withRename(m, "b", "c");
  assert.deepEqual(m, { a: "c", b: "c" });
});

test("renaming back to an old id makes it a real book again", () => {
  let m = withRename({}, "a", "b");
  m = withRename(m, "b", "a");
  assert.deepEqual(m, { b: "a" });
});

test("other books' renames are kept", () => {
  assert.deepEqual(withRename({ x: "y" }, "a", "b"), { x: "y", a: "b" });
});
