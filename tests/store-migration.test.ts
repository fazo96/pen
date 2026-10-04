import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { DOCS_DIR } from "../lib/paths.ts";

// The one-time move from the old flat layout (data/<id>.md) to
// data/<id>/manuscript.md, on the store's first use in a process: so this
// file has a process (and scratch library) of its own.

test("old flat files become project folders; a folder already there is left alone", async () => {
  await mkdir(path.join(DOCS_DIR, "both"), { recursive: true });
  await writeFile(path.join(DOCS_DIR, "flat.md"), "# Flat");
  await writeFile(path.join(DOCS_DIR, "both.md"), "# Old copy");
  await writeFile(path.join(DOCS_DIR, "both", "manuscript.md"), "# New copy");
  await writeFile(path.join(DOCS_DIR, "Not An Id.md"), "# Odd");
  const { listDocs, readDoc } = await import("../lib/docs.ts");
  assert.equal((await readDoc("flat"))?.content, "# Flat");
  assert.equal((await readDoc("both"))?.content, "# New copy");
  assert.deepEqual((await listDocs()).map((d) => d.id).sort(), ["both", "flat"]);
  assert.deepEqual((await readdir(DOCS_DIR)).sort(), ["Not An Id.md", "both", "both.md", "flat"]);
  assert.equal(await readFile(path.join(DOCS_DIR, "both.md"), "utf8"), "# Old copy");
});
