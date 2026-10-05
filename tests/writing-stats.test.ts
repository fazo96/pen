import assert from "node:assert/strict";
import { test } from "node:test";
import { measureEdit, measureSave, workOf } from "../lib/writingStats.ts";

// How one save changed a document, drafting or editing (lib/writingStats.ts).

const book = (...paras: string[]) => ["# Rain", ...paras].join("\n\n");

test("a new paragraph is drafting", () => {
  assert.deepEqual(measureEdit(book("One."), book("One.", "The rain fell on the harbour.")), {
    drafted: 6,
    editAdded: 0,
    removed: 0,
    pasted: 0,
  });
});

test("typing into the empty paragraph Enter made (saved as &nbsp;) is drafting", () => {
  const empty = book("One.", "&nbsp;");
  assert.deepEqual(measureEdit(book("One."), empty), { drafted: 0, editAdded: 0, removed: 0, pasted: 0 });
  assert.deepEqual(measureEdit(empty, book("One.", "Five new words typed here.")), {
    drafted: 5,
    editAdded: 0,
    removed: 0,
    pasted: 0,
  });
  assert.equal(measureEdit(book("One.", "Fiv"), book("One.", "Five new words typed here.")).drafted, 4);
});

test("writing on at the end of a paragraph is drafting, a word cut off by the save included", () => {
  assert.deepEqual(measureEdit(book("The rain fe"), book("The rain fell on the harbour.")), {
    drafted: 3,
    editAdded: 0,
    removed: 0,
    pasted: 0,
  });
  // Started in the last save with a single word.
  assert.equal(measureEdit(book("Th"), book("The cat sat.")).drafted, 2);
});

test("fixing a typo while writing on is still drafting, counted net", () => {
  assert.deepEqual(measureEdit(book("She ran to teh"), book("She ran to the market at dawn.")), {
    drafted: 3,
    editAdded: 0,
    removed: 0,
    pasted: 0,
  });
});

test("words inserted inside a paragraph, or replaced, are editing", () => {
  const d = measureEdit(book("She ran to the market."), book("She ran quickly to the old market."));
  assert.deepEqual(d, { drafted: 0, editAdded: 2, removed: 0, pasted: 0 });
  const r = measureEdit(book("He walked to the store in the morning."), book("He ran to the store in the morning."));
  assert.deepEqual(r, { drafted: 0, editAdded: 1, removed: 1, pasted: 0 });
  assert.equal(workOf(r), "editing");
});

test("rewriting a whole short paragraph is editing, not drafting", () => {
  const d = measureEdit(book("Old words."), book("Something new entirely."));
  assert.equal(d.drafted, 0);
  assert.equal(workOf(d), "editing");
});

test("cutting a paragraph or the end of one is removing", () => {
  assert.deepEqual(measureEdit(book("Keep.", "Cut this scene now.", "End."), book("Keep.", "End.")), {
    drafted: 0,
    editAdded: 0,
    removed: 4,
    pasted: 0,
  });
  assert.deepEqual(measureEdit(book("He left. Nobody saw him go."), book("He left.")), {
    drafted: 0,
    editAdded: 0,
    removed: 4,
    pasted: 0,
  });
});

test("splitting or joining paragraphs moves words, it doesn't write them", () => {
  const joined = book("The rain fell all night. In the morning the harbour was gone.");
  const split = book("The rain fell all night.", "In the morning the harbour was gone.");
  assert.deepEqual(measureEdit(joined, split), { drafted: 0, editAdded: 0, removed: 0, pasted: 0 });
  assert.deepEqual(measureEdit(split, joined), { drafted: 0, editAdded: 0, removed: 0, pasted: 0 });
});

test("pasted words count as neither drafting nor editing", () => {
  const big = "Pasted words from elsewhere arrive all at once here.";
  assert.deepEqual(measureEdit(book("One."), book("One.", big), 9), { drafted: 0, editAdded: 0, removed: 0, pasted: 9 });
  // Never more than what was added (a paste undone before the save).
  assert.deepEqual(measureEdit(book("One."), book("One.", "Two words."), 50), {
    drafted: 0,
    editAdded: 0,
    removed: 0,
    pasted: 2,
  });
});

test("straightening quotes, and comments, are not writing", () => {
  assert.deepEqual(measureEdit(book("“Hello,” she said. It’s late."), book('"Hello," she said. It\'s late.')), {
    drafted: 0,
    editAdded: 0,
    removed: 0,
    pasted: 0,
  });
  assert.deepEqual(measureEdit(book("One."), book("One.", "%% a note to self about the plot %%")), {
    drafted: 0,
    editAdded: 0,
    removed: 0,
    pasted: 0,
  });
});

test("a new document is all drafting", () => {
  assert.equal(measureEdit("", book("The first line.")).drafted, 4);
});

test("workOf: drafting when new words outweigh editing", () => {
  assert.equal(workOf({ drafted: 0, editAdded: 0, removed: 0, pasted: 30 }), null);
  assert.equal(workOf({ drafted: 500, editAdded: 40, removed: 60, pasted: 0 }), "drafting");
  assert.equal(workOf({ drafted: 100, editAdded: 80, removed: 60, pasted: 0 }), "editing");
});

const novel = (...lines: string[]) =>
  ["# Rain", "## Part One", "Before any chapter.", "### The Harbour", "Mara walked down.", "### Salt", "The road was dust."]
    .concat(lines)
    .join("\n\n");

test("the chapters a save touched, by heading; added text by where it is now, removed by where it was", () => {
  const base = novel();
  assert.deepEqual(measureSave(base, base.replace("Mara walked down.", "Mara walked down to the water.")).chapters, ["The Harbour"]);
  assert.deepEqual(
    measureSave(base, base.replace("Mara walked down.", "Mara ran.").replace("The road was dust.", "The road was dust and ash.")).chapters,
    ["The Harbour", "Salt"],
  );
  // A new paragraph at the end belongs to the last chapter; a removed one to its old chapter.
  assert.deepEqual(measureSave(base, novel("A new paragraph.")).chapters, ["Salt"]);
  assert.deepEqual(measureSave(base, base.replace("\n\nMara walked down.", "")).chapters, ["The Harbour"]);
  // Renaming a chapter touches it under both names.
  assert.deepEqual(measureSave(base, base.replace("### Salt", "### Salt and Ash")).chapters, ["Salt", "Salt and Ash"]);
  // Formatting heading text doesn't change its name; escapes stay.
  assert.deepEqual(measureSave(novel(), novel().replace("### Salt", "### *Salt* \\*1")).chapters, ["Salt", "Salt *1"]);
});

test("no chapter when unsure: before the first, under a part heading, under a heading with no words", () => {
  const base = novel();
  assert.deepEqual(measureSave(base, base.replace("Before any chapter.", "Before any chapter at all.")).chapters, []);
  const untitled = "# Rain\n\n### The Harbour\n\nOne.\n\n###\n\nUnder no name.";
  assert.deepEqual(measureSave(untitled, untitled.replace("Under no name.", "Under no name yet.")).chapters, []);
  const parted = "# Rain\n\n### The Harbour\n\nOne.\n\n## Part Two\n\nIn the part.";
  assert.deepEqual(measureSave(parted, parted.replace("In the part.", "In the part, still.")).chapters, []);
  // A save with no words changed (a heading level, say) touches nothing it can name.
  assert.deepEqual(measureSave(base, base).chapters, []);
});
