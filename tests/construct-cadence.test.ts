import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createDoc, GLOBAL } from "../lib/docs.ts";
import { callTool } from "../lib/construct/tools/index.ts";

// Construct's Cadence tools (lib/construct/tools/cadence.ts): scan_prose and
// the writer's pronunciations, on the scratch library, with the browser
// tests' small dictionary in place of the CMU download.

process.env.PEN_PRONUNCIATIONS = fileURLToPath(new URL("./fixtures/cmudict-mini.dict", import.meta.url));

let prosodyChanges = 0;
const ctx = (projectId: string) => ({
  projectId,
  onCodexChange: () => {},
  beforeManuscriptEdit: async () => {},
  onManuscriptChange: () => {},
  onProsodyChange: () => void prosodyChanges++,
});

const BOOK = "# Scan Book\n\n### One\n\nThe river ran beneath the broken stone.\n\nKvothe fell.\n\n### Two\n\nThe night was still.";

test("scan_prose reads the manuscript's paragraphs as Cadence does, cited by line, headings left out", async () => {
  const { id } = await createDoc(BOOK);
  const out = (await callTool("scan_prose", {}, ctx(id))).text;
  assert.match(out, /^Marks, one per syllable/);
  assert.match(out, /pen:L5 · 1 sentence, 10 syllables\nThe\(x\) river\(\/x\) ran\(\/\) beneath\(x\/\) the\(x\) broken\(\/x\) stone\(\/\)\./);
  assert.match(out, /Runs: iambic, 5 feet: “The river ran beneath the broken stone”/);
  assert.match(out, /pen:L7 [\s\S]*Not in the dictionary, stress guessed: Kvothe\(\/\)\./);
  assert.doesNotMatch(out, /Scan Book\(/, "the title isn't prose");

  const two = (await callTool("scan_prose", { heading: "Two" }, ctx(id))).text;
  assert.match(two, /pen:L11/);
  assert.doesNotMatch(two, /pen:L5/);
  assert.equal((await callTool("scan_prose", { from_line: 1, to_line: 3 }, ctx(id))).text, "No paragraphs of prose in that range.");
});

test("scan_prose reads any text, to check a rewrite", async () => {
  const { id } = await createDoc(BOOK);
  const out = (await callTool("scan_prose", { text: "In the dark of the night and the cold of the stone.\n\nThe river ran." }, ctx(id))).text;
  assert.match(out, /Paragraph 1 · [\s\S]*Runs: anapestic, 4 feet/);
  assert.match(out, /Paragraph 2 · 1 sentence, 4 syllables/);
  const empty = await callTool("scan_prose", { text: "   " }, ctx(id));
  assert.ok(empty.isError);
  assert.ok((await callTool("scan_prose", { text: "a ".repeat(2500) }, ctx(id))).isError, "too long");
});

test("Construct keeps the writer's pronunciations as they do, and scan_prose follows them", async () => {
  const { id } = await createDoc(BOOK);
  const before = prosodyChanges;
  const set = await callTool("set_pronunciation", { word: "Kvothe", stress: "/", sounds_like: "quoth" }, ctx(id));
  assert.deepEqual(set, { text: "Set how “kvothe” is said: stress /, sounds like “quoth”.", isError: false });
  assert.equal(prosodyChanges, before + 1);
  assert.equal((await callTool("list_pronunciations", {}, ctx(id))).text, "kvothe: stress /, sounds like “quoth”");
  assert.match((await callTool("scan_prose", { text: "Kvothe fell." }, ctx(id))).text, /Said the writer's way: Kvothe\./);

  assert.ok((await callTool("set_pronunciation", { word: "Denna", stress: "DEN-na" }, ctx(id))).isError);
  assert.ok((await callTool("set_pronunciation", { word: "two words", stress: "/" }, ctx(id))).isError);
  assert.ok((await callTool("set_pronunciation", { word: "Denna" }, ctx(id))).isError, "a stress or a sounds-like");
  assert.equal(prosodyChanges, before + 1, "refusals change nothing");

  assert.equal((await callTool("remove_pronunciation", { word: "KVOTHE" }, ctx(id))).text, "Forgot how “kvothe” is said.");
  assert.ok((await callTool("remove_pronunciation", { word: "kvothe" }, ctx(id))).isError);
  assert.equal((await callTool("list_pronunciations", {}, ctx(id))).text, "None set yet.");
});

test("the Global Codex's chats keep pronunciations but have no manuscript to scan", async () => {
  assert.match((await callTool("scan_prose", {}, ctx(GLOBAL))).text, /Unknown tool/);
  const set = await callTool("set_pronunciation", { word: "Auri", stress: "/x" }, ctx(GLOBAL));
  assert.equal(set.isError, false);
  await callTool("remove_pronunciation", { word: "Auri" }, ctx(GLOBAL));
});
