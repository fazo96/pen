import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createExclusive, writeAtomic } from "../lib/files.ts";

// Whole-file writes (lib/files.ts).

const scratch = async () => mkdtemp(path.join(os.tmpdir(), "pen-files-"));

test("writeAtomic creates folders, replaces the file and leaves no temporary files", async () => {
  const dir = await scratch();
  try {
    const file = path.join(dir, "a", "b", "x.json");
    await writeAtomic(file, "one");
    await writeAtomic(file, "two");
    assert.equal(await readFile(file, "utf8"), "two");
    assert.deepEqual(await readdir(path.dirname(file)), ["x.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeAtomic can set the file's mode", async () => {
  const dir = await scratch();
  try {
    const file = path.join(dir, "secret.json");
    await writeAtomic(file, "{}", { mode: 0o600 });
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("concurrent writes each land whole", async () => {
  const dir = await scratch();
  try {
    const file = path.join(dir, "x.txt");
    const versions = Array.from({ length: 20 }, (_, i) => String(i).repeat(10_000));
    await Promise.all(versions.map((v) => writeAtomic(file, v)));
    assert.ok(versions.includes(await readFile(file, "utf8")));
    assert.deepEqual(await readdir(dir), ["x.txt"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createExclusive never replaces a file", async () => {
  const dir = await scratch();
  try {
    const file = path.join(dir, "entry.md");
    assert.equal(await createExclusive(file, "first"), true);
    assert.equal(await createExclusive(file, "second"), false);
    assert.equal(await readFile(file, "utf8"), "first");
    assert.deepEqual(await readdir(dir), ["entry.md"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
