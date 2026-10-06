import assert from "node:assert/strict";
import { test } from "node:test";
import { entryFromReply, imageTypeOf, transcribePrompt } from "../lib/transcribe.ts";

// Photos of handwritten notes into Codex entries (lib/transcribe.ts); the
// agent run itself is tested in oneoff.test.ts.

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
  // Into the Global Codex: no book, its own entries for names.
  const shared = transcribePrompt(1, { book: null, entries: ["Style Sheet"] });
  assert.match(shared, /for the Global Codex \(the notes a novelist keeps for all their books\)/);
  assert.doesNotMatch(shared, /the book "/);
  assert.match(shared, /The Global Codex already has these entries[\s\S]*- Style Sheet$/);
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
