import { stripComments, straightQuotes, wordCount } from "./text";
import { alignBlocks, blockKey, wordDiff } from "./textdiff";

// How one save changed a document, in words, sorted by the kind of work it
// looks like: drafting (new paragraphs, words added at the end of one) or
// editing (words inserted into existing text, words removed). Only the counts
// are kept; whether a day was drafting or editing is decided when it's shown
// (`workOf`), so the heuristic can change without losing anything. Pure:
// lib/store/stats.ts stores the result, the stats page reads it.

export type Delta = {
  /** Words in new paragraphs, or added at the end of one. */
  drafted: number;
  /** Words added inside existing text. */
  editAdded: number;
  /** Words removed. */
  removed: number;
  /** Words the editor reported pasting, taken out of the two above. */
  pasted: number;
};

export const NO_CHANGE: Delta = { drafted: 0, editAdded: 0, removed: 0, pasted: 0 };

/** Retyping this many words at the end of a paragraph (a typo, a word cut off by the save) is still drafting. */
const TYPO_WORDS = 3;

/**
 * Blocks with words in them (an empty paragraph is saved as "&nbsp;", which
 * isn't a word, and neither is any other entity), and the chapter each is in:
 * the text of the `###` heading over it, or null before the first chapter,
 * after a title or part heading, and under a chapter heading without words
 * (not sure what to call it).
 */
function blocksOf(markdown: string): { blocks: string[]; chapters: (string | null)[] } {
  const blocks: string[] = [];
  const chapters: (string | null)[] = [];
  let chapter: string | null = null;
  for (const raw of straightQuotes(stripComments(markdown))
    .replace(/&(?:[a-z]+|#\d+|#x[\da-f]+);/gi, " ")
    .split(/\n[ \t]*\n/)) {
    const block = blockKey(raw);
    const h = block.match(/^(#{1,3})(?!#)(?:\s+(.*?))?(?:\s+#+)?$/);
    if (h) chapter = h[1].length === 3 ? (h[2] ?? "").replace(/\\([!-/:-@[-`{-~])|[*_~`]/g, (_m, esc?: string) => esc ?? "").trim() || null : null;
    if (!wordCount(block)) continue;
    blocks.push(block);
    chapters.push(chapter);
  }
  return { blocks, chapters };
}

function bag(texts: string[]) {
  const m = new Map<string, number>();
  for (const t of texts)
    for (const w of t.toLowerCase().match(/[\p{L}\p{N}’'-]*[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu) ?? []) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

/** Words found both among the removed and the added: text moved (a paragraph split or joined), not written. */
function moved(removed: string[], added: string[]) {
  const a = bag(added);
  let n = 0;
  for (const [w, k] of bag(removed)) n += Math.min(k, a.get(w) ?? 0);
  return n;
}

/** What one save changed: the words (`measureEdit`), and the chapters it touched, in order. */
export type Measured = { delta: Delta; chapters: string[] };

/**
 * What changed between two saves of a document. `pasted`: words the editor saw
 * pasted since the last save, which count as neither drafting nor editing.
 */
export const measureEdit = (before: string, after: string, pasted = 0): Delta => measureSave(before, after, pasted).delta;

/** `measureEdit`, and the chapters whose text changed: added or edited text's chapter in the new text, removed text's in the old. */
export function measureSave(before: string, after: string, pasted = 0): Measured {
  const { blocks: a, chapters: inA } = blocksOf(before);
  const { blocks: b, chapters: inB } = blocksOf(after);
  const touched = new Set<string>();
  const touch = (chapter: string | null) => chapter !== null && touched.add(chapter);
  let drafted = 0;
  const draftedText: string[] = [];
  const editAddedText: string[] = [];
  const removedText: string[] = [];

  const ops = alignBlocks(a, b);
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.op === "same") continue;
    if (op.op !== "added") touch(inA[op.a]);
    if (op.op !== "removed") touch(inB[op.b]);
    const next = ops[i + 1];
    if (op.op === "removed" && next?.op === "added") {
      // A paragraph replaced in place: writing on if the new one starts with the
      // old one (too short to be paired as an edit), else a rewrite.
      i++;
      touch(inB[next.b]);
      const [gone, fresh] = [a[op.a], b[next.b]];
      if (fresh.toLowerCase().startsWith(gone.toLowerCase())) {
        drafted += Math.max(0, wordCount(fresh) - wordCount(gone));
        draftedText.push(fresh);
      } else {
        removedText.push(gone);
        editAddedText.push(fresh);
      }
      continue;
    }
    if (op.op === "added") {
      draftedText.push(b[op.b]);
      drafted += wordCount(b[op.b]);
      continue;
    }
    if (op.op === "removed") {
      removedText.push(a[op.a]);
      continue;
    }
    // An edited paragraph: what changed after its last unchanged words is its end.
    const parts = wordDiff(a[op.a], b[op.b]);
    let end = parts.length;
    while (end > 0 && (parts[end - 1].added || parts[end - 1].removed || !wordCount(parts[end - 1].value))) end--;
    const tailAdded = parts.slice(end).filter((p) => p.added).map((p) => p.value);
    const tailRemoved = parts.slice(end).filter((p) => p.removed).map((p) => p.value);
    const nAdded = wordCount(tailAdded.join(" "));
    const nRemoved = wordCount(tailRemoved.join(" "));
    // With nothing left unchanged it's a rewrite, unless one word was cut off by the last save.
    if (nAdded > nRemoved && nRemoved <= (end > 0 ? TYPO_WORDS : 1)) {
      // Writing on: only the net words count, so retyped ones aren't counted twice.
      drafted += nAdded - nRemoved;
      if (nAdded) draftedText.push(tailAdded.join(" "));
    } else {
      editAddedText.push(...tailAdded);
      removedText.push(...tailRemoved);
    }
    for (const p of parts.slice(0, end)) {
      if (p.added) editAddedText.push(p.value);
      else if (p.removed) removedText.push(p.value);
    }
  }

  let editAdded = wordCount(editAddedText.join(" "));
  let removed = wordCount(removedText.join(" "));
  // Moved words cancel out, taken from editing first.
  let same = Math.min(moved(removedText, [...editAddedText, ...draftedText]), removed);
  removed -= same;
  const fromEdit = Math.min(same, editAdded);
  editAdded -= fromEdit;
  same -= fromEdit;
  drafted = Math.max(0, drafted - same);

  // Pasted words: taken from drafting first (most pastes land as new paragraphs).
  const paste = Math.max(0, Math.min(Math.floor(pasted), drafted + editAdded));
  const fromDraft = Math.min(paste, drafted);
  return {
    delta: { drafted: drafted - fromDraft, editAdded: editAdded - (paste - fromDraft), removed, pasted: paste },
    chapters: [...touched],
  };
}

/** Counts for a span of time, summed from slots. */
export type Totals = Delta & { activeMs: number };

export const emptyTotals = (): Totals => ({ ...NO_CHANGE, activeMs: 0 });

export function addTotals(into: Totals, from: Delta & { activeMs?: number }): Totals {
  into.drafted += from.drafted;
  into.editAdded += from.editAdded;
  into.removed += from.removed;
  into.pasted += from.pasted;
  into.activeMs += from.activeMs ?? 0;
  return into;
}

/** New words, typed (pasted ones don't count). */
export const written = (t: Delta) => t.drafted + t.editAdded;

/** Editing: words inserted into existing text plus words removed. */
export const edited = (t: Delta) => t.editAdded + t.removed;

/** Whether a span of time was mostly drafting or editing; null with nothing written. */
export function workOf(t: Delta): "drafting" | "editing" | null {
  if (!t.drafted && !edited(t)) return null;
  return t.drafted > edited(t) ? "drafting" : "editing";
}

export type StatsKind = "manuscript" | "codex";

/** One book's saves in 15 minutes, as stored in .pen-stats/ (lib/store/stats.ts). */
export type Slot = Delta & {
  /** The slot's start, ms since the epoch (UTC). */
  t: number;
  book: string;
  kind: StatsKind;
  /** The Codex entry's id, for kind codex (absent in slots from before it was kept). */
  entry?: string;
  /** Manuscript chapters the saves changed, by heading; empty when none was sure. */
  chapters?: string[];
  saves: number;
  activeMs: number;
};
