import assert from "node:assert/strict";
import { test } from "node:test";
import { codexHome, entryHref, entryOfHref, entryOfRef, refOf } from "../lib/entryRef.ts";
import { GLOBAL, isOwnerId, isValidId } from "../lib/ids.ts";

test("GLOBAL owns a Codex but can't be a book's id", () => {
  assert.equal(isValidId(GLOBAL), false);
  assert.ok(isOwnerId(GLOBAL));
  assert.ok(isOwnerId("rain"));
  assert.equal(isOwnerId("../rain"), false);
});

test("an entry's page, by whose Codex it's in, and read back", () => {
  assert.equal(entryHref("rain", "mara"), "/d/rain/codex/mara");
  assert.equal(entryHref(GLOBAL, "style"), "/codex/style");
  assert.equal(codexHome("rain"), "/d/rain");
  assert.equal(codexHome(GLOBAL), "/codex");
  assert.deepEqual(entryOfHref("/d/rain/codex/mara"), { owner: "rain", id: "mara" });
  assert.deepEqual(entryOfHref("/codex/style"), { owner: GLOBAL, id: "style" });
  for (const href of ["/d/rain", "/codex", "/codex/Style", "/d/rain/codex/mara?x", "/d/rain/import/job"]) {
    assert.equal(entryOfHref(href), null, href);
  }
});

test("in a book, the entry beside the manuscript is its id, or global/<id>", () => {
  assert.equal(refOf({ owner: "rain", id: "mara" }), "mara");
  assert.equal(refOf({ owner: GLOBAL, id: "style" }), "global/style");
  assert.deepEqual(entryOfRef("rain", "mara"), { owner: "rain", id: "mara" });
  assert.deepEqual(entryOfRef("rain", "global/style"), { owner: GLOBAL, id: "style" });
  // On the Global Codex's own page, a plain id is its own.
  assert.deepEqual(entryOfRef(GLOBAL, "style"), { owner: GLOBAL, id: "style" });
  assert.equal(entryOfRef("rain", "global/"), null);
  assert.equal(entryOfRef("rain", "../x"), null);
});
