import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { FlagCache } from "../lib/grammarCache.ts";
import type { Flag } from "../lib/grammarText.ts";

const dirs: string[] = [];
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));
async function scratch() {
  const d = await mkdtemp(path.join(tmpdir(), "pen-grammar-cache-"));
  dirs.push(d);
  return d;
}

const flag = (problem: string): Flag => ({
  start: 0,
  end: problem.length,
  rule: "SpellCheck",
  kind: "Spelling",
  message: `Did you mean to spell \`${problem}\` this way?`,
  problem,
  suggestions: [{ kind: "replace", text: "across" }],
  hash: "123",
});

test("flags are kept on disk and read back by a new cache", async () => {
  const dir = await scratch();
  const a = new FlagCache(dir);
  await a.use("s1");
  a.set("She walked accross.", [flag("accross")]);
  a.set("Nothing wrong here.", []);
  await a.flush();
  const b = new FlagCache(dir);
  await b.use("s1");
  assert.deepEqual(b.get("She walked accross."), [flag("accross")]);
  assert.deepEqual(b.get("Nothing wrong here."), []);
  assert.equal(b.get("Never checked."), undefined);
  // The file names paragraphs by hash, not by their text.
  const raw = await readFile(path.join(dir, "s1.jsonl"), "utf8");
  assert.ok(!raw.includes("She walked"));
});

test("other settings get their own file, and only the newest few are kept", async () => {
  const dir = await scratch();
  const cache = new FlagCache(dir, 100, 2);
  for (const [i, s] of ["s1", "s2", "s3", "s4"].entries()) {
    await cache.use(s);
    cache.set("A paragraph.", [flag(s)]);
    await cache.flush();
    const t = new Date(Date.now() - (10 - i) * 60_000);
    await utimes(path.join(dir, `${s}.jsonl`), t, t);
  }
  assert.deepEqual(cache.get("A paragraph."), [flag("s4")]);
  await cache.use("s5");
  assert.equal(cache.get("A paragraph."), undefined);
  // s5 has no file until something is checked with it.
  assert.deepEqual((await readdir(dir)).sort(), ["s3.jsonl", "s4.jsonl"]);
  await cache.use("s3");
  assert.deepEqual(cache.get("A paragraph."), [flag("s3")]);
});

test("past the limit the least recently used go, and the file is written anew", async () => {
  const dir = await scratch();
  const cache = new FlagCache(dir, 10);
  await cache.use("s");
  for (let i = 0; i < 10; i++) cache.set(`Paragraph ${i}.`, []);
  cache.get("Paragraph 0."); // used again: kept
  for (let i = 10; i < 20; i++) cache.set(`Paragraph ${i}.`, []);
  await cache.flush();
  assert.equal(cache.size, 10);
  assert.deepEqual(cache.get("Paragraph 0."), undefined, "pushed out by ten newer ones");
  const reread = new FlagCache(dir, 10);
  await reread.use("s");
  assert.equal(reread.size, 10);
  assert.deepEqual(reread.get("Paragraph 19."), []);
  assert.equal(reread.get("Paragraph 1."), undefined);
  const lines = (await readFile(path.join(dir, "s.jsonl"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 10);
});

test("a line cut short by a crash is skipped", async () => {
  const dir = await scratch();
  const a = new FlagCache(dir);
  await a.use("s");
  a.set("Kept.", []);
  await a.flush();
  await writeFile(path.join(dir, "s.jsonl"), (await readFile(path.join(dir, "s.jsonl"), "utf8")) + '["abc",[{"sta');
  const b = new FlagCache(dir);
  await b.use("s");
  assert.deepEqual(b.get("Kept."), []);
  assert.equal(b.size, 1);
});

test("a folder that can't be written still caches in memory", async () => {
  const dir = await scratch();
  const file = path.join(dir, "not-a-folder");
  await writeFile(file, "");
  const cache = new FlagCache(path.join(file, "grammar"));
  const warn = console.warn;
  console.warn = () => {};
  try {
    await cache.use("s");
    cache.set("Remembered.", []);
    await cache.flush();
    assert.deepEqual(cache.get("Remembered."), []);
  } finally {
    console.warn = warn;
  }
});
