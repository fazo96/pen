import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { jsonStore } from "../lib/jsonStore.ts";

// Library-wide JSON files (lib/jsonStore.ts).

type Counts = { n: number };
const parse = (raw: unknown): Counts => {
  const n = (raw as { n?: unknown } | null)?.n;
  if (typeof n !== "number") throw new Error("not counts");
  return { n };
};

async function withFile(fn: (file: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pen-json-"));
  try {
    await fn(path.join(dir, "sub", ".pen-test.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("missing, corrupt or invalid files read as the fallback", () =>
  withFile(async (file) => {
    const store = jsonStore(file, parse, () => ({ n: 0 }));
    assert.deepEqual(await store.read(), { n: 0 });
    await store.update(() => ({ n: 1 }));
    await writeFile(file, "{ not json");
    assert.deepEqual(await store.read(), { n: 0 });
    await writeFile(file, JSON.stringify({ n: "x" }));
    assert.deepEqual(await store.read(), { n: 0 });
  }));

test("updates run one at a time, each on the last one's result", () =>
  withFile(async (file) => {
    const store = jsonStore(file, parse, () => ({ n: 0 }));
    const bump = (c: Counts) => new Promise<Counts>((r) => setTimeout(() => r({ n: c.n + 1 }), Math.random() * 5));
    const results = await Promise.all(Array.from({ length: 10 }, () => store.update(bump)));
    assert.deepEqual(results.map((r) => r.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { n: 10 });
  }));

test("returning the current value writes nothing; a failed change writes nothing", () =>
  withFile(async (file) => {
    const store = jsonStore(file, parse, () => ({ n: 0 }));
    await store.update((c) => c);
    await assert.rejects(readFile(file, "utf8"), { code: "ENOENT" });
    await assert.rejects(store.update(() => Promise.reject(new Error("no"))), /no/);
    assert.deepEqual(await store.update((c) => ({ n: c.n + 1 })), { n: 1 });
  }));
