import assert from "node:assert/strict";
import { test } from "node:test";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { dropTargets, moveSection, sectionEnd, sectionWords, staysPut, stepTarget } from "../lib/sections.ts";

// The Contents tab's sections (lib/sections.ts): their extent, words, and moves.

// Title, Part I (ch 1 with scenes 1.1 and 1.2, ch 2), Part II (ch 3).
const BOOK = [1, 2, 3, 4, 4, 3, 2, 3];

test("a section runs to the next heading of the same or higher rank", () => {
  assert.equal(sectionEnd(BOOK, 0), 8);
  assert.equal(sectionEnd(BOOK, 1), 6);
  assert.equal(sectionEnd(BOOK, 2), 5);
  assert.equal(sectionEnd(BOOK, 3), 4);
  assert.equal(sectionEnd(BOOK, 4), 5);
  assert.equal(sectionEnd(BOOK, 7), 8);
});

test("a section's words include those of the sections inside it", () => {
  assert.deepEqual(sectionWords(BOOK, [1, 2, 10, 20, 30, 40, 2, 50]), [155, 102, 60, 20, 30, 40, 52, 50]);
});

test("sections go only before a heading of their rank or higher, never above the title", () => {
  assert.deepEqual(dropTargets(BOOK, 0), [], "the title stays");
  // Chapter 2: before part I, before chapter 1, its own place (5, 6), before part II, before chapter 3, the end.
  assert.deepEqual(dropTargets(BOOK, 5), [1, 2, 5, 6, 7, 8]);
  // Chapter 1 can't land inside itself.
  assert.deepEqual(dropTargets(BOOK, 2), [1, 2, 5, 6, 7, 8]);
  // Part I: before itself, before part II, the end.
  assert.deepEqual(dropTargets(BOOK, 1), [1, 6, 8]);
  // A scene can go anywhere below the title.
  assert.deepEqual(dropTargets(BOOK, 3), [1, 2, 3, 4, 5, 6, 7, 8]);
  // With no title, a section can go to the very top.
  assert.deepEqual(dropTargets([3, 3], 1), [0, 1, 2]);
});

test("a section stays put when dropped at either end of itself", () => {
  assert.ok(staysPut(BOOK, 2, 2));
  assert.ok(staysPut(BOOK, 2, 5));
  assert.ok(!staysPut(BOOK, 2, 6));
  assert.ok(!staysPut(BOOK, 5, 2));
});

test("stepping moves a section past its neighbour, across parts and chapters", () => {
  assert.equal(stepTarget(BOOK, 5, -1), 2, "chapter 2 up: before chapter 1");
  assert.equal(stepTarget(BOOK, 2, 1), 6, "chapter 1 down: after chapter 2");
  assert.equal(stepTarget(BOOK, 5, 1), 7, "chapter 2 down: into part II");
  assert.equal(stepTarget(BOOK, 7, -1), 6, "chapter 3 up: out of part II, to the end of part I");
  assert.equal(stepTarget(BOOK, 7, 1), null, "the last chapter is at the bottom");
  assert.equal(stepTarget(BOOK, 3, -1), 2, "scene 1.1 up: to the end of the text before chapter 1");
  assert.equal(stepTarget(BOOK, 1, -1), null, "part I is at the top");
  assert.equal(stepTarget(BOOK, 0, 1), null);
});

const schema = getSchema([StarterKit]);
const h = (level: number, t: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text: t }] });
const p = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const docOf = (...content: unknown[]) => schema.nodeFromJSON({ type: "doc", content });
const blocks = (state: EditorState) => {
  const out: string[] = [];
  state.doc.forEach((n) => {
    out.push(n.textContent);
  });
  return out;
};

const book = () =>
  EditorState.create({
    doc: docOf(h(1, "T"), p("intro"), h(3, "One"), p("a"), h(4, "S1"), p("b"), h(3, "Two"), p("c"), h(3, "Three"), p("d")),
  });
const LEVELS = [1, 3, 4, 3, 3];

test("moving a chapter takes its scenes and is one step", () => {
  const state = book();
  const tr = moveSection(state, LEVELS, 1, 4)!;
  assert.deepEqual(blocks(state.apply(tr)), ["T", "intro", "Two", "c", "One", "a", "S1", "b", "Three", "d"]);
  const up = moveSection(state, LEVELS, 4, 1)!;
  assert.deepEqual(blocks(state.apply(up)), ["T", "intro", "Three", "d", "One", "a", "S1", "b", "Two", "c"]);
  const end = moveSection(state, LEVELS, 1, 5)!;
  assert.deepEqual(blocks(state.apply(end)), ["T", "intro", "Two", "c", "Three", "d", "One", "a", "S1", "b"]);
});

test("a scene moves into another chapter", () => {
  const state = book();
  const tr = moveSection(state, LEVELS, 2, 4)!;
  assert.deepEqual(blocks(state.apply(tr)), ["T", "intro", "One", "a", "Two", "c", "S1", "b", "Three", "d"]);
});

test("no move when it changes nothing, isn't allowed, or the document changed", () => {
  const state = book();
  assert.equal(moveSection(state, LEVELS, 1, 1), null);
  assert.equal(moveSection(state, LEVELS, 1, 3), null);
  assert.equal(moveSection(state, LEVELS, 1, 2), null, "inside itself");
  assert.equal(moveSection(state, LEVELS, 0, 5), null, "the title");
  assert.equal(moveSection(state, LEVELS, 3, 0), null, "above the title");
  assert.equal(moveSection(state, [1, 3, 3, 3], 1, 3), null, "headings the writer didn't see");
});

test("a cursor inside the section goes with it", () => {
  let state = book();
  // Inside "a", chapter One's paragraph.
  let at = -1;
  state.doc.descendants((n, pos) => {
    if (n.isText && n.text === "a") at = pos;
  });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at + 1)));
  const next = state.apply(moveSection(state, LEVELS, 1, 5)!);
  assert.equal(next.selection.$from.parent.textContent, "a");
  assert.equal(next.selection.$from.parentOffset, 1);
});
