import assert from "node:assert/strict";
import { mkdir, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { DOCS_DIR } from "../lib/paths.ts";
import * as docs from "../lib/docs.ts";
import { libraryFiles } from "../lib/library.ts";
import { readRenames } from "../lib/renames.ts";
import { addVersion } from "../lib/versions.ts";

// The library on disk (lib/docs.ts, lib/store/), in the scratch library
// tests/setup.mjs points PEN_DIR at.

test("the tests write to a scratch library, never ./data", () => {
  assert.ok(!DOCS_DIR.startsWith(process.cwd()), DOCS_DIR);
});

test("a save based on an old version is refused, unless it brings the same text or is forced", async () => {
  const doc = await docs.createDoc("# Rain\n\nOne.");
  assert.equal(doc.id, "rain");
  const first = await docs.writeDoc(doc.id, "# Rain\n\nTwo.", doc.version);
  assert.ok(first.ok);
  // Another device, still on the first version.
  const stale = await docs.writeDoc(doc.id, "# Rain\n\nThree.", doc.version);
  assert.deepEqual(stale, { ok: false, current: { id: "rain", content: "# Rain\n\nTwo.", version: first.version } });
  // The same change arriving twice (a page left, then its backup) isn't a conflict.
  assert.ok((await docs.writeDoc(doc.id, "# Rain\n\nTwo.", doc.version)).ok);
  assert.ok((await docs.writeDoc(doc.id, "# Rain\n\nThree.", doc.version, true)).ok);
  assert.equal((await docs.readDoc(doc.id))?.content, "# Rain\n\nThree.");
  // A second book with the same title gets its own folder.
  assert.equal((await docs.createDoc("# Rain")).id, "rain-2");
});

test("the first save after a quiet half hour keeps the text before it as a version", async () => {
  const doc = await docs.createDoc("# Gap\n\nBefore.");
  const file = path.join(DOCS_DIR, doc.id, "manuscript.md");
  const hourAgo = new Date(Date.now() - 60 * 60_000);
  await utimes(file, hourAgo, hourAgo);
  await docs.writeDoc(doc.id, "# Gap\n\nAfter.", doc.version);
  await docs.writeDoc(doc.id, "# Gap\n\nAfter, again.", null);
  const versions = await docs.listVersions(doc.id);
  assert.deepEqual(
    versions.map((v) => [v.kind, v.label]),
    [["auto", "Session start"]],
  );
  assert.equal(await docs.readVersion(doc.id, versions[0].id), "# Gap\n\nBefore.");
});

test("restoring a version keeps the current text first; named versions stay, automatic ones keep the newest 30", async () => {
  const doc = await docs.createDoc("# Restore\n\nFirst draft.");
  const named = await docs.saveVersion(doc.id, "First");
  assert.ok(named);
  await docs.writeDoc(doc.id, "# Restore\n\nSecond draft.", null);
  const restored = await docs.restoreVersion(doc.id, named.id);
  assert.equal(restored?.content, "# Restore\n\nFirst draft.");
  const [before] = await docs.listVersions(doc.id);
  assert.equal(before.label, "Before restore");
  assert.equal(await docs.readVersion(doc.id, before.id), "# Restore\n\nSecond draft.");
  assert.equal(await docs.restoreVersion(doc.id, "1999-01-01T00-00-00-000Z"), null);

  const dir = path.join(DOCS_DIR, doc.id);
  for (let i = 0; i < 32; i++) await addVersion(dir, `draft ${i}`, "auto", "Auto", Date.now() + i * 1000);
  const all = await docs.listVersions(doc.id);
  assert.equal(all.filter((v) => v.kind === "auto").length, 30);
  assert.ok(all.some((v) => v.id === named.id));
  assert.equal((await readdir(path.join(dir, "versions"))).filter((n) => n.endsWith(".md")).length, 31);
});

test("renaming a book moves its folder, records the old id and pins Construct's folder", async () => {
  const doc = await docs.createDoc("# Old Name");
  await docs.createDoc("# Taken");
  assert.equal(await docs.renameDoc(doc.id, "taken"), "taken");
  assert.equal(await docs.renameDoc("no-such-book", "anything"), "missing");
  assert.equal(await docs.renameDoc(doc.id, "Not Valid"), "invalid");
  await docs.writeChat(doc.id, "c1", { v: 1 });
  assert.equal(await docs.renameDoc(doc.id, "new-name"), "ok");
  assert.equal(await docs.readDoc(doc.id), null);
  assert.equal((await docs.readDoc("new-name"))?.content, "# Old Name");
  assert.equal((await readRenames())[doc.id], "new-name");
  // The agent keeps its old folder name, and with it its sessions.
  assert.equal(await docs.agentHome("new-name"), doc.id);
  assert.deepEqual(await docs.readChats("new-name"), [{ v: 1 }]);
});

test("Codex entries: created by title, renamed and trashed, and the spots follow", async () => {
  const doc = await docs.createDoc("# Codex Book");
  const mara = await docs.createEntry(doc.id, "# Mara\n\nA sailor.");
  assert.equal(mara?.id, "mara");
  assert.equal((await docs.createEntry(doc.id, "# Mara"))?.id, "mara-2");
  assert.equal(await docs.createEntry("no-such-book", "# X"), null);
  const place = { block: 1, q: "A sailor", off: 0 };
  const spot = { anchor: place, head: place, top: place };
  assert.ok(await docs.writeSpot(doc.id, "mara", spot));
  assert.equal(await docs.writeSpot(doc.id, "nobody", spot), false);
  assert.equal((await docs.readSpots(doc.id)).last, "mara");

  assert.ok(await docs.renameEntry(doc.id, "mara", "mara-voss"));
  assert.equal(await docs.renameEntry(doc.id, "mara-2", "mara-voss"), false); // taken
  assert.equal((await docs.readSpots(doc.id)).last, "mara-voss");
  assert.ok(await docs.trashEntry(doc.id, "mara-voss"));
  assert.equal((await docs.readSpots(doc.id)).last, undefined);
  assert.deepEqual(
    (await docs.listCodex(doc.id))?.map((e) => e.id),
    ["mara-2"],
  );
  const trash = await readdir(path.join(DOCS_DIR, ".trash"));
  assert.ok(trash.some((n) => n.startsWith(`${doc.id}--codex--mara-voss--`) && n.endsWith(".md")), trash.join());

  assert.ok(await docs.trashDoc(doc.id));
  assert.equal(await docs.trashDoc(doc.id), false);
  assert.ok((await readdir(path.join(DOCS_DIR, ".trash"))).some((n) => /^codex-book--\d{4}-/.test(n)));
});

test("the Global Codex: entries no book owns, moved to and from a book's Codex", async () => {
  const style = await docs.createEntry(docs.GLOBAL, "# Style\n\nSerial commas.");
  assert.equal(style?.id, "style");
  assert.equal((await docs.readEntry(docs.GLOBAL, "style"))?.content, "# Style\n\nSerial commas.");
  assert.ok((await readdir(path.join(DOCS_DIR, ".pen-global", "codex"))).includes("style.md"));
  // It's no book: not on the shelves, no manuscript, nothing that writes one takes it.
  assert.ok(!(await docs.listDocs()).some((d) => d.id === docs.GLOBAL || d.id.includes("global")));
  assert.equal(await docs.readDoc(docs.GLOBAL), null);
  await assert.rejects(docs.writeDoc(docs.GLOBAL, "# Nope", null));

  const book = await docs.createDoc("# Shared World");
  await docs.createEntry(book.id, "# Harbour\n\nFog.");
  await docs.createEntry(docs.GLOBAL, "# Harbour\n\nAnother harbour.");
  const place = { block: 1, q: "Fog", off: 0 };
  assert.ok(await docs.writeSpot(book.id, "harbour", { anchor: place, head: place, top: place }));

  // Into the Global Codex: "harbour" is taken there, so it becomes harbour-2, and the book's spot forgets it.
  assert.equal(await docs.moveEntry(book.id, "harbour", docs.GLOBAL), "harbour-2");
  assert.equal(await docs.readEntry(book.id, "harbour"), null);
  assert.equal((await docs.readEntry(docs.GLOBAL, "harbour-2"))?.content, "# Harbour\n\nFog.");
  assert.equal((await docs.readSpots(book.id)).last, undefined);
  // And back into the book, keeping its id there.
  assert.equal(await docs.moveEntry(docs.GLOBAL, "style", book.id), "style");
  assert.deepEqual((await docs.listCodex(book.id))?.map((e) => e.id), ["style"]);
  assert.deepEqual((await docs.listCodex(docs.GLOBAL))?.map((e) => e.id).sort(), ["harbour", "harbour-2"]); // same title
  // Nothing to move, nowhere to move it, or already there.
  assert.equal(await docs.moveEntry(book.id, "nobody", docs.GLOBAL), null);
  assert.equal(await docs.moveEntry(book.id, "style", "no-such-book"), null);
  assert.equal(await docs.moveEntry(book.id, "style", book.id), null);

  const names: string[] = [];
  for await (const f of libraryFiles()) names.push(f.name);
  assert.ok(names.includes(".pen-global/codex/harbour-2.md"), names.join());
});

test("the library export leaves out the password and anything else not on its list", async () => {
  await docs.createDoc("# Exported");
  await writeFile(path.join(DOCS_DIR, ".pen-auth.json"), '{"hash":"secret"}');
  await writeFile(path.join(DOCS_DIR, ".pen-shelves.json"), "{}");
  await mkdir(path.join(DOCS_DIR, ".claude"), { recursive: true });
  await writeFile(path.join(DOCS_DIR, ".claude", "credentials.json"), "{}");
  await writeFile(path.join(DOCS_DIR, "exported", "manuscript.md.tmp"), "half-written");
  const names: string[] = [];
  for await (const f of libraryFiles()) names.push(f.name);
  assert.ok(names.includes("exported/manuscript.md"));
  assert.ok(names.includes(".pen-shelves.json"));
  for (const n of names) assert.ok(!/pen-auth|\.claude|\.tmp$/.test(n), n);
  assert.equal(await readFile(path.join(DOCS_DIR, ".pen-auth.json"), "utf8"), '{"hash":"secret"}');
});
