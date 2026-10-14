// A document's sections, by the levels of its headings in order: heading i's
// section runs to the next heading of the same or higher rank. The Contents
// tab counts their words and moves them.

import { closeHistory } from "@tiptap/pm/history";
import type { Node as PMNode } from "@tiptap/pm/model";
import { type EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";

/** The heading that ends heading i's section, or `levels.length` when it runs to the end. */
export function sectionEnd(levels: number[], i: number): number {
  for (let j = i + 1; j < levels.length; j++) if (levels[j] <= levels[i]) return j;
  return levels.length;
}

/** Each section's words, from the words under each heading up to the next one (its own included). */
export function sectionWords(levels: number[], own: number[]): number[] {
  return levels.map((_, i) => {
    let sum = 0;
    for (let j = i; j < sectionEnd(levels, i); j++) sum += own[j];
    return sum;
  });
}

/**
 * Where heading i's section can go: before heading j, or at the end (j = `levels.length`).
 * Only before a heading of the same or higher rank, so it never takes over the sections
 * that follow; never above the title or inside itself. Its own place is included twice
 * (i and its end). The title doesn't move.
 */
export function dropTargets(levels: number[], i: number): number[] {
  if (levels[i] === 1) return [];
  const title = levels.indexOf(1);
  const end = sectionEnd(levels, i);
  const out: number[] = [];
  for (let j = title + 1; j <= levels.length; j++) {
    if (j > i && j < end) continue;
    if (j === levels.length || levels[j] <= levels[i]) out.push(j);
  }
  return out;
}

/** Whether dropping heading i's section before j leaves it where it is. */
export const staysPut = (levels: number[], i: number, j: number) => j >= i && j <= sectionEnd(levels, i);

/** The next place up (-1) or down (1) for heading i's section, or null at the top or bottom. */
export function stepTarget(levels: number[], i: number, dir: -1 | 1): number | null {
  const targets = dropTargets(levels, i);
  const end = sectionEnd(levels, i);
  const found = dir < 0 ? targets.filter((j) => j < i).at(-1) : targets.find((j) => j > end);
  return found ?? null;
}

/** The document's top-level headings: where each starts, and its level. */
export function headingsOf(doc: PMNode): { pos: number; level: number }[] {
  const out: { pos: number; level: number }[] = [];
  doc.forEach((node, pos) => {
    if (node.type.name === "heading") out.push({ pos, level: node.attrs.level as number });
  });
  return out;
}

/**
 * Move heading i's section before heading j (or to the end), as one step to undo.
 * `levels` is what the writer saw; null when the document no longer matches it,
 * or when the move isn't allowed or changes nothing. A selection inside the
 * section goes with it.
 */
export function moveSection(state: EditorState, levels: number[], i: number, j: number): Transaction | null {
  const heads = headingsOf(state.doc);
  if (heads.length !== levels.length || heads.some((h, k) => h.level !== levels[k])) return null;
  if (staysPut(levels, i, j) || !dropTargets(levels, i).includes(j)) return null;
  const size = state.doc.content.size;
  const at = (k: number) => (k < heads.length ? heads[k].pos : size);
  const from = at(i);
  const to = at(sectionEnd(levels, i));
  const target = at(j);
  const content = state.doc.slice(from, to).content;
  const insert = target > from ? target - (to - from) : target;
  // Its own step to undo, even right after another move.
  const tr = closeHistory(state.tr.delete(from, to).insert(insert, content));
  const { anchor, head } = state.selection;
  if (anchor >= from && anchor < to && head >= from && head < to) {
    const pos = (p: number) => tr.doc.resolve(insert + p - from);
    tr.setSelection(TextSelection.between(pos(anchor), pos(head)));
  }
  return tr;
}
