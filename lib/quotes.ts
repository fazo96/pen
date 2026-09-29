import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, type Transaction } from "@tiptap/pm/state";
import { straightQuotes } from "./text";

// pen keeps plain " and '. Curly ones still arrive from imports, pastes, phone
// keyboards with smart punctuation, and text typed before this rule; they're
// straightened wherever they show up. Code is left alone.

const CURLY = /[“”‘’]/;

const isCode = (node: PMNode) => node.type.name === "codeBlock" || node.marks.some((m) => m.type.name === "code");

/**
 * Adds the replacements for `from`–`to` to `tr`, one character at a time so the
 * cursor stays put. Quotes are one character each way, so positions hold.
 */
function straightenRange(doc: PMNode, tr: Transaction, from: number, to: number) {
  const done = new Set<number>();
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "codeBlock") return false;
    if (!node.isText || !CURLY.test(node.text!) || isCode(node)) return true;
    const text = node.text!;
    for (let i = 0; i < text.length; i++) {
      if (!CURLY.test(text[i]) || done.has(pos + i)) continue;
      done.add(pos + i);
      tr.replaceWith(pos + i, pos + i + 1, doc.type.schema.text(straightQuotes(text[i]), node.marks));
    }
    return true;
  });
}

export function hasCurlyQuotes(doc: PMNode) {
  let found = false;
  doc.descendants((node) => {
    if (found || node.type.name === "codeBlock") return false;
    if (node.isText && CURLY.test(node.text!) && !isCode(node)) found = true;
    return !found;
  });
  return found;
}

/** A transaction straightening the whole document, or null if there's nothing to do. Not undoable. */
export function straightenQuotes(state: EditorState): Transaction | null {
  const tr = state.tr;
  straightenRange(state.doc, tr, 0, state.doc.content.size);
  return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
}

/** Straightens quotes in whatever a change brings in: typing, paste, drop, setContent. */
export const StraightQuotes = Extension.create({
  name: "straightQuotes",
  addProseMirrorPlugins: () => [
    new Plugin({
      appendTransaction(trs, _old, state) {
        // Changed ranges, in the final document.
        let ranges: [number, number][] = [];
        for (const tr of trs) {
          if (!tr.docChanged) continue;
          ranges = ranges.map(([f, t]) => [tr.mapping.map(f, -1), tr.mapping.map(t, 1)]);
          tr.mapping.maps.forEach((map, i) => {
            const rest = tr.mapping.slice(i + 1);
            map.forEach((_s, _e, from, to) => ranges.push([rest.map(from, -1), rest.map(to, 1)]));
          });
        }
        if (!ranges.length) return null;
        const size = state.doc.content.size;
        const tr = state.tr;
        for (const [f, t] of ranges) straightenRange(state.doc, tr, Math.max(0, f), Math.min(size, t));
        return tr.docChanged ? tr : null;
      },
    }),
  ],
});
