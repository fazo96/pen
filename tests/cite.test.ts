import assert from "node:assert/strict";
import { test } from "node:test";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { anchorCitations, findPassage, lineSnippet, parseCitation, withSnippets } from "../lib/cite.ts";

// Construct's pen: citation links (lib/cite.ts).

test("parseCitation reads manuscript, version and Codex links", () => {
  assert.deepEqual(parseCitation("pen:L12"), { kind: "manuscript", from: 12, to: 12, q: undefined, qe: undefined });
  assert.deepEqual(parseCitation("pen:L12-L20"), { kind: "manuscript", from: 12, to: 20, q: undefined, qe: undefined });
  assert.deepEqual(parseCitation("pen:L12-20?q=The%20rain&qe=End"), {
    kind: "manuscript",
    from: 12,
    to: 20,
    q: "The rain",
    qe: "End",
  });
  assert.deepEqual(parseCitation("pen:v/2026-01-02T03-04-05/L40"), {
    kind: "version",
    version: "2026-01-02T03-04-05",
    from: 40,
    to: 40,
    q: undefined,
    qe: undefined,
  });
  assert.deepEqual(parseCitation("pen:codex/mara-voss"), { kind: "codex", entry: "mara-voss" });
  assert.deepEqual(parseCitation("pen:global/style"), { kind: "codex", entry: "style", global: true });
});

test("parseCitation rejects what isn't a citation", () => {
  for (const href of ["https://x.org", "pen:", "pen:L0", "pen:codex/../etc", "pen:codex/Mara", "pen:global/../x", "pen:chapter/3"]) {
    assert.equal(parseCitation(href), null, href);
  }
  // A backwards range is read as the single line.
  assert.deepEqual(parseCitation("pen:L20-L12"), { kind: "manuscript", from: 20, to: 20, q: undefined, qe: undefined });
});

test("lineSnippet gives the start of a line as the writer sees it", () => {
  assert.equal(lineSnippet("### The *harbour* at [night](x)"), "The harbour at night");
  assert.equal(lineSnippet("> “Go,” she said. %% fix %%"), "\"Go,\" she said.");
  assert.equal(lineSnippet(""), undefined);
  assert.equal(lineSnippet("# A"), undefined); // too short to find again
  const long = "word ".repeat(30);
  const s = lineSnippet(long, 20)!;
  assert.ok(s.length <= 20 && !s.endsWith(" ") && s.startsWith("word word"), s);
});

test("withSnippets adds the cited lines' text, once", () => {
  const lines = ["# Title", "", "The rain fell (at last).", "It stopped."];
  assert.equal(withSnippets("pen:L3", lines), "pen:L3?q=The%20rain%20fell%20%28at%20last%29.");
  assert.equal(withSnippets("pen:L3-L4", lines), "pen:L3-L4?q=The%20rain%20fell%20%28at%20last%29.&qe=It%20stopped.");
  assert.equal(withSnippets("pen:L3?q=x", lines), "pen:L3?q=x");
  assert.equal(withSnippets("pen:codex/mara", lines), "pen:codex/mara");
  assert.equal(withSnippets("pen:L2", lines), "pen:L2"); // a blank line has nothing to quote
});

test("anchorCitations anchors a reply's manuscript and version links, leaving Codex and anchored ones", async () => {
  const linesOf = async (version?: string) => (version === "gone" ? null : version ? ["Old first line."] : ["# Title", "The rain fell."]);
  const reply = "See [the rain](pen:L2), [again](pen:L2), [then](pen:v/v1/L1), [lost](pen:v/gone/L1), [Mara](pen:codex/mara) and [done](pen:L2?q=x).";
  assert.equal(
    await anchorCitations(reply, linesOf),
    "See [the rain](pen:L2?q=The%20rain%20fell.), [again](pen:L2?q=The%20rain%20fell.), [then](pen:v/v1/L1?q=Old%20first%20line.), [lost](pen:v/gone/L1), [Mara](pen:codex/mara) and [done](pen:L2?q=x).",
  );
  assert.equal(await anchorCitations("No links here.", linesOf), "No links here.");
});

const schema = getSchema([StarterKit]);
const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = schema.nodeFromJSON({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
    para("The rain fell at last."),
    para("Mara ran to the harbour."),
    para("It stopped."),
  ],
});
const lines = ["# Title", "", "The rain fell at last.", "", "Mara ran to the harbour.", "", "It stopped."];
const blockAt = (pos: number) => doc.resolve(pos + 1).parent.textContent;

test("findPassage finds a passage by its text, even after lines moved", () => {
  // The line number is stale (points at the title), the quote still finds it.
  const found = findPassage(doc, lines, { from: 1, to: 1, q: "Mara ran" })!;
  assert.equal(blockAt(found.from), "Mara ran to the harbour.");
  const range = findPassage(doc, lines, { from: 3, to: 7, q: "The rain", qe: "It stopped" })!;
  assert.equal(blockAt(range.from), "The rain fell at last.");
  assert.equal(range.to, doc.content.size);
});

test("findPassage falls back to the line number, and gives up when neither works", () => {
  const found = findPassage(doc, lines, { from: 5, to: 5 })!;
  assert.equal(blockAt(found.from), "Mara ran to the harbour.");
  assert.equal(findPassage(doc, lines, { from: 99, to: 99, q: "not in the text" }), null);
});
