import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { entryFromReply, imageTypeOf, runTranscription, TimeoutError, transcribePrompt } from "../lib/transcribe.ts";

// Photos of handwritten notes into Codex entries (lib/transcribe.ts), against
// a stub ACP agent that stands in for Claude Code.

const stub = fileURLToPath(new URL("fixtures/stub-acp-agent.mjs", import.meta.url));
const launch = (mode = "ok", timeoutMs?: number) => ({
  command: [process.execPath, stub],
  cwd: path.join(tmpdir(), "pen-transcribe-test"),
  env: { STUB_MODE: mode },
  timeoutMs,
});
const jpeg = { data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64"), mimeType: "image/jpeg" };
const png = { data: "", mimeType: "image/png" };

test("recognises the image formats Claude reads by their bytes", () => {
  assert.equal(imageTypeOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe1])), "image/jpeg");
  assert.equal(imageTypeOf(Buffer.from("\x89PNG\r\n\x1a\n....", "latin1")), "image/png");
  assert.equal(imageTypeOf(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1")), "image/webp");
  assert.equal(imageTypeOf(Buffer.from("GIF89a....", "latin1")), "image/gif");
  assert.equal(imageTypeOf(Buffer.from("\0\0\0\x18ftypheic", "latin1")), null); // HEIC
  assert.equal(imageTypeOf(Buffer.from("<html>", "latin1")), null);
});

test("the prompt asks for guesses over gaps, and gives the Codex names", () => {
  const one = transcribePrompt(1, { book: "Salt and Signal", entries: ["Mara Quell", "The Lantern Docks"] });
  assert.match(one, /This photo is a handwritten note/);
  assert.match(one, /"Salt and Signal"/);
  assert.match(one, /wrong guess is far better than a gap/);
  assert.match(one, /- Mara Quell\n- The Lantern Docks$/);
  const three = transcribePrompt(3, { book: "B", entries: [] });
  assert.match(three, /These 3 photos are pages of one handwritten note, in order/);
  assert.doesNotMatch(three, /already has these entries/);
});

test("turns the reply into an entry with a title", () => {
  assert.equal(entryFromReply("# Mara\n\n- tall\n"), "# Mara\n\n- tall\n");
  assert.equal(entryFromReply("```markdown\n# Mara\n\nShe’s “tall”\n```"), "# Mara\n\nShe's \"tall\"\n");
  assert.equal(entryFromReply("Here's the transcription:\n\n# Mara\n\ntall"), "# Mara\n\ntall\n");
  assert.equal(entryFromReply("just some words\r\nmore"), "# Handwritten note\n\njust some words\nmore\n");
  // A long opening that isn't preamble stays; the note just gets a title.
  const untitled = "line one\nline two\nline three\n# Heading later";
  assert.equal(entryFromReply(untitled), `# Handwritten note\n\n${untitled}\n`);
});

test("sends the pages to the agent and collects its reply", { timeout: 30_000 }, async () => {
  const reply = await runTranscription([jpeg, png], "Transcribe.", launch());
  assert.equal(entryFromReply(reply), "# Notes\n\n2 pages: image/jpeg, image/png\n");
});

test("reports an agent that fails, can't see images, says nothing or hangs", { timeout: 30_000 }, async () => {
  await assert.rejects(runTranscription([jpeg], "x", launch("crash")), /exited \(3\): not logged in/);
  await assert.rejects(runTranscription([jpeg], "x", launch("blind")), /can't read images/);
  await assert.rejects(runTranscription([jpeg], "x", launch("silent")), /no transcription/);
  await assert.rejects(runTranscription([jpeg], "x", launch("hang", 1000)), TimeoutError);
});
