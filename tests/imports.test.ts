import assert from "node:assert/strict";
import { test } from "node:test";
import { dropImport, getImport, type ImportEvent, importPage, listImports, startImport, watchImport } from "../lib/imports.ts";

// Note imports as jobs (lib/imports.ts): the transcription itself is tested in
// oneoff.test.ts and transcribe.test.ts.

const photo = { data: Buffer.from([0xff, 0xd8, 0xff]), mimeType: "image/jpeg" };
const tick = () => new Promise((r) => setImmediate(r));

test("streams the text to watchers and ends with the entry", async () => {
  let say: (t: string) => void = () => {};
  let think: (t: string) => void = () => {};
  let finish: (id: string) => void = () => {};
  const job = startImport("book-a", [photo, photo], ({ onText, onThought }) => {
    say = onText;
    think = onThought;
    return new Promise((r) => (finish = r));
  });
  assert.equal(getImport("book-a", job)?.status, "running");
  assert.equal(getImport("book-b", job), null, "another book can't see it");
  assert.equal(importPage("book-a", job, 1), photo);
  assert.equal(importPage("book-a", job, 2), null);

  think("Two pages.");
  say("# Mara");
  const seen: ImportEvent[] = [];
  watchImport("book-a", job, (e) => seen.push(e));
  say("\n\ntall");
  finish("mara");
  await tick();
  assert.deepEqual(seen, [
    { t: "state", pages: 2, status: "running", text: "# Mara", thinking: "Two pages." },
    { t: "text", text: "\n\ntall" },
    { t: "entry", id: "mara" },
  ]);
  assert.deepEqual(listImports("book-a").find((j) => j.id === job)?.entry, "mara");

  // Watching a finished job gives only its snapshot.
  const late: ImportEvent[] = [];
  watchImport("book-a", job, (e) => late.push(e));
  assert.deepEqual(late, [{ t: "state", pages: 2, status: "done", text: "# Mara\n\ntall", thinking: "Two pages.", entry: "mara" }]);

  assert.equal(dropImport("book-a", job), true);
  assert.equal(getImport("book-a", job), null);
});

test("stopping aborts the work and says so", async () => {
  const job = startImport("book-a", [photo], ({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
  const seen: ImportEvent[] = [];
  watchImport("book-a", job, (e) => seen.push(e));
  assert.equal(dropImport("book-a", job), true);
  await tick();
  assert.deepEqual(seen.at(-1), { t: "error", error: "stopped" });
  assert.equal(getImport("book-a", job)?.status, "failed");
  assert.equal(dropImport("book-c", job), false);
});

test("a failure keeps its reason", async () => {
  const job = startImport("book-d", [photo], async () => {
    throw new Error("the agent can't read images");
  });
  await tick();
  assert.deepEqual(listImports("book-d"), [
    { id: job, pages: 1, status: "failed", started: getImport("book-d", job)!.started, error: "the agent can't read images" },
  ]);
});
