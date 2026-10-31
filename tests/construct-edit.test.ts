import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { getEditMode, setEditMode } from "../lib/construct/settings.ts";
import { callTool, listTools } from "../lib/construct/tools/index.ts";
import { createDoc, GLOBAL, readDoc } from "../lib/docs.ts";
import { DOCS_DIR } from "../lib/paths.ts";

// Construct's manuscript editing (lib/construct/tools/edit.ts): what each of
// the writer's Manuscript settings lets through, on the scratch library.

const BOOK = "# Edit Book\n\n## Part One\n\n### Harbour\n\nThe gulls cried over the water.\n\nMara counted the boats.\nThen she slept.\n";

function harness(projectId: string) {
  const seen = { before: 0, changed: 0 };
  const ctx = {
    projectId,
    onCodexChange: () => {},
    beforeManuscriptEdit: async () => void seen.before++,
    onManuscriptChange: () => void seen.changed++,
  };
  const call = (name: string, args: Record<string, unknown>) => callTool(name, args, ctx);
  const text = async () => (await readDoc(projectId))!.content;
  return { seen, call, text };
}

test("the Manuscript setting is per book, Off unless set, and unreadable reads as Off", async () => {
  const { id } = await createDoc("# Mode Book");
  assert.equal(await getEditMode(id), "off");
  assert.equal(await setEditMode(id, "comments"), "comments");
  assert.equal(await getEditMode(id), "comments");
  const { id: other } = await createDoc("# Other Mode Book");
  assert.equal(await getEditMode(other), "off", "another book's is its own");
  await writeFile(path.join(DOCS_DIR, id, "construct.json"), '{"manuscript":"everything"}');
  assert.equal(await getEditMode(id), "off");
  assert.equal(await getEditMode(GLOBAL), "off");
});

test("Off: every editing tool refuses and the manuscript stays as it was", async () => {
  const { id } = await createDoc(BOOK);
  const { seen, call, text } = harness(id);
  for (const [name, args] of [
    ["add_comment", { line: 7, text: "Too quiet?" }],
    ["edit_manuscript", { old_text: "gulls", new_text: "terns" }],
    ["insert_manuscript", { after_line: 7, text: "A bell rang." }],
  ] as const) {
    const out = await call(name, args);
    assert.equal(out.isError, true, name);
    assert.match(out.text, /Manuscript setting is Off/);
  }
  assert.equal(await text(), BOOK);
  assert.deepEqual(seen, { before: 0, changed: 0 });
});

test("Only comments: comments come and go, and the prose can't change", async () => {
  const { id } = await createDoc(BOOK);
  await setEditMode(id, "comments");
  const { seen, call, text } = harness(id);

  assert.equal((await call("add_comment", { line: 7, text: "Too quiet?" })).text, "Added a comment after line 7, as line 9.");
  assert.equal(await text(), BOOK.replace("water.\n", "water.\n\n%% Too quiet? %%\n"));
  assert.deepEqual(seen, { before: 1, changed: 1 });
  assert.equal((await call("add_comment", { line: 11, text: "Whose  boats?\n", after: "the boats" })).text, "Added a comment on line 11.");
  assert.match(await text(), /^Mara counted the boats %% Whose boats\? %%\.$/m);

  assert.equal((await call("edit_comment", { line: 9, text: "Quiet on purpose." })).isError, false);
  assert.match(await text(), /^%% Quiet on purpose\. %%$/m);
  assert.equal((await call("remove_comment", { line: 11 })).isError, false);
  assert.match(await text(), /^Mara counted the boats\.$/m);
  assert.equal((await call("remove_comment", { line: 9, comment: "quiet" })).isError, false);
  assert.equal(await text(), BOOK, "back where it started");

  // Mistakes, and anything that would touch the prose.
  assert.match((await call("add_comment", { line: 9, text: "x" })).text, /runs on into line 10/);
  assert.match((await call("add_comment", { line: 8, text: "x" })).text, /is blank/);
  assert.match((await call("add_comment", { line: 99, text: "x" })).text, /no line 99/);
  assert.match((await call("add_comment", { line: 7, text: "a %% b" })).text, /can't contain/);
  assert.match((await call("add_comment", { line: 7, text: "x", after: " " })).text, /more than once/);
  assert.match((await call("remove_comment", { line: 7 })).text, /has no comment/);
  assert.match((await call("edit_manuscript", { old_text: "gulls", new_text: "terns" })).text, /only lets Construct change the manuscript's comments/);
  assert.match((await call("insert_manuscript", { after_line: 7, text: "A bell rang." })).text, /only lets/);
  assert.equal(await text(), BOOK);
});

test("Only comments keeps a writer's comment of either kind, and its padding", async () => {
  const { id } = await createDoc("# Kept\n\nShe ran <!--too fast?--> home.\n\n%%\nlong note\n%%\n\nNext.");
  await setEditMode(id, "comments");
  const { call, text } = harness(id);
  await call("edit_comment", { line: 3, text: "fast enough" });
  assert.match(await text(), /^She ran <!--fast enough--> home\.$/m);
  await call("edit_comment", { line: 5, text: "short note" });
  assert.match(await text(), /^%%\nshort note\n%%$/m);
  await call("remove_comment", { line: 5 });
  assert.equal(await text(), "# Kept\n\nShe ran <!--fast enough--> home.\n\nNext.");
});

test("Full: edits and inserted passages, and the comment tools still", async () => {
  const { id } = await createDoc(BOOK);
  await setEditMode(id, "full");
  const { seen, call, text } = harness(id);

  assert.equal((await call("edit_manuscript", { old_text: "gulls cried", new_text: "terns wheeled" })).text, "Edited the manuscript (1 replacement).");
  assert.match((await call("edit_manuscript", { old_text: "the", new_text: "a" })).text, /matches \d+ times/);
  assert.match((await call("edit_manuscript", { old_text: "nowhere", new_text: "x" })).text, /not found/);
  const inserted = await call("insert_manuscript", { after_line: 7, text: "\nA bell rang.\n\n#### Night\n" });
  assert.equal(inserted.text, "Inserted 3 lines after line 7 (now lines 9–11).");
  assert.equal(
    await text(),
    "# Edit Book\n\n## Part One\n\n### Harbour\n\nThe terns wheeled over the water.\n\nA bell rang.\n\n#### Night\n\nMara counted the boats.\nThen she slept.\n",
  );
  assert.match((await call("insert_manuscript", { after_line: 13, text: "x" })).text, /runs on into line 14/);
  assert.equal((await call("add_comment", { line: 9, text: "New." })).isError, false);
  assert.deepEqual(seen, { before: 3, changed: 3 });
});

test("the editing tools are a book's: the Global Codex's chats don't get them", () => {
  const names = ["add_comment", "edit_comment", "remove_comment", "edit_manuscript", "insert_manuscript"];
  const { id } = { id: "any-book" };
  for (const name of names) {
    assert.ok(listTools(id).some((t) => t.name === name), name);
    assert.ok(!listTools(GLOBAL).some((t) => t.name === name), name);
  }
});
