import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import * as docs from "../lib/docs.ts";
import { libraryFiles } from "../lib/library.ts";
import { DOCS_DIR } from "../lib/paths.ts";
import { readSlots, recordSave, SLOT_MS, statsSettled } from "../lib/store/stats.ts";
import { writingReport } from "../lib/writing.ts";

// The writing stats on disk (lib/store/stats.ts) and as the pages get them
// (lib/writing.ts), in the scratch library tests/setup.mjs points PEN_DIR at.

const statsFile = (month: string) => path.join(DOCS_DIR, ".pen-stats", `${month}.json`);

test("saves add up in their 15-minute slot, by book and kind, a month to a file", async () => {
  const t = Date.UTC(2025, 0, 31, 23, 50); // the last slot of January
  await recordSave({ book: "slots", kind: "manuscript", before: "", after: "One two three.", pasted: 0, title: "Slots", now: t });
  await recordSave({ book: "slots", kind: "manuscript", before: "One two three.", after: "One two three. Four.", pasted: 0, now: t + 60_000 });
  await recordSave({ book: "slots", kind: "codex", before: "", after: "A note.", pasted: 0, now: t + 90_000 });
  await recordSave({ book: "slots", kind: "manuscript", before: "x", after: "x\n\nFebruary words.", pasted: 0, now: t + 11 * 60_000 });

  const jan = await readSlots(Date.UTC(2025, 0, 1), Date.UTC(2025, 1, 1));
  assert.deepEqual(
    jan.slots.map((s) => [s.t, s.kind, s.drafted, s.saves, s.activeMs]),
    [
      [Math.floor(t / SLOT_MS) * SLOT_MS, "manuscript", 4, 2, 60_000],
      [Math.floor(t / SLOT_MS) * SLOT_MS, "codex", 2, 1, 30_000],
    ],
  );
  assert.deepEqual(jan.titles, { slots: "Slots" });
  // The next save, 9.5 minutes after the last: a new session, no time counted, and February's file.
  const feb = await readSlots(Date.UTC(2025, 1, 1), Date.UTC(2025, 2, 1));
  assert.deepEqual(
    feb.slots.map((s) => [s.drafted, s.activeMs]),
    [[2, 0]],
  );
  assert.ok(JSON.parse(await readFile(statsFile("2025-02"), "utf8")).slots.length === 1);
});

test("only saves marked as the writer's are tracked, and only when the text changed", async () => {
  const doc = await docs.createDoc("# Tracked\n\nOne.");
  const before = (await readSlots(0, Date.now() + SLOT_MS)).slots.filter((s) => s.book === doc.id);
  assert.equal(before.length, 0);
  // Construct, a restore or an import: no `track`.
  await docs.writeDoc(doc.id, "# Tracked\n\nOne.\n\nNot by the writer.", null);
  const w = await docs.writeDoc(doc.id, "# Tracked\n\nOne.\n\nNot by the writer.\n\nTyped by the writer.", null, false, { pasted: 0 });
  assert.ok(w.ok);
  await docs.writeDoc(doc.id, "# Tracked\n\nOne.\n\nNot by the writer.\n\nTyped by the writer.", null, false, { pasted: 0 });
  await docs.createEntry(doc.id, "# Place", "place");
  await docs.writeEntry(doc.id, "place", "# Place\n\nA harbour town.", null, false, { pasted: 0 });
  await statsSettled();
  const slots = (await readSlots(0, Date.now() + SLOT_MS)).slots.filter((s) => s.book === doc.id);
  assert.deepEqual(
    slots.map((s) => [s.kind, s.drafted, s.saves]),
    [
      ["manuscript", 4, 1],
      ["codex", 3, 1],
    ],
  );
});

test("the report follows renames and keeps gone books under their last title", async () => {
  const doc = await docs.createDoc("# Old Name\n\nOne.");
  await docs.writeDoc(doc.id, "# Old Name\n\nOne.\n\nTwo words.", null, false, { pasted: 0 });
  await statsSettled();
  assert.equal(await docs.renameDoc(doc.id, "new-name"), "ok");
  const gone = await docs.createDoc("# Gone Book\n\nOne.");
  await docs.writeDoc(gone.id, "# Gone Book\n\nOne.\n\nMore.", null, false, { pasted: 0 });
  await statsSettled();
  assert.ok(await docs.trashDoc(gone.id));

  const report = await writingReport(0, Date.now() + SLOT_MS);
  assert.ok(report.slots.some((s) => s.book === "new-name" && s.drafted === 2));
  assert.ok(!report.slots.some((s) => s.book === doc.id));
  assert.deepEqual(report.books["new-name"], { title: "Old Name", gone: false });
  assert.deepEqual(report.books[gone.id], { title: "Gone Book", gone: true });
});

test("a damaged stats file reads as empty rather than failing", async () => {
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(statsFile("2024-03")), { recursive: true });
  await writeFile(statsFile("2024-03"), "{ not json");
  assert.deepEqual(await readSlots(Date.UTC(2024, 2, 1), Date.UTC(2024, 3, 1)), { slots: [], titles: {} });
  await writeFile(statsFile("2024-03"), JSON.stringify({ slots: [{ t: 5, book: "../evil", kind: "manuscript" }, "junk"] }));
  assert.deepEqual((await readSlots(0, Date.UTC(2024, 3, 1))).slots.filter((s) => s.t === 5), []);
});

test("the library export includes the writing stats", async () => {
  const names: string[] = [];
  for await (const f of libraryFiles()) names.push(f.name);
  assert.ok(names.includes(".pen-stats/2025-01.json"), names.join(", "));
});
