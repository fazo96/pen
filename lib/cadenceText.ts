import type { Node as PMNode } from "@tiptap/pm/model";
import { textBlocks, type TextBlock } from "./grammarText";

// What Cadence reads: the paragraph at the cursor, or the paragraphs a
// selection touches (up to MAX_BLOCKS), as the grammar check sees them
// (comments and code left out), joined by blank lines, with a way back from
// the passage's offsets to document positions. Pure.

export const MAX_BLOCKS = 6;

export type Passage = {
  text: string;
  /** How many paragraphs it spans (MAX_BLOCKS at most), and whether the selection had more. */
  blocks: number;
  cut: boolean;
  /** Document positions of the passage's `[start, end)`, for showing a word in the text. */
  range: (start: number, end: number) => { from: number; to: number } | null;
};

/** The block a document position is in: the one starting last at or before it. */
function blockAt(blocks: TextBlock[], pos: number): number {
  let found = -1;
  for (let i = 0; i < blocks.length && blocks[i].pos < pos; i++) found = i;
  return found;
}

export function passageAt(doc: PMNode, from: number, to: number): Passage | null {
  const blocks = textBlocks(doc);
  const a = blockAt(blocks, from);
  const b = blockAt(blocks, to);
  if (a < 0) return null;
  // The cursor must be in the block found, not in a skipped one (a comment) after it.
  const inside = (i: number, pos: number) => {
    const node = doc.nodeAt(blocks[i].pos);
    return !!node && pos <= blocks[i].pos + node.nodeSize;
  };
  if (!inside(a, from)) return null;
  const last = Math.min(b, a + MAX_BLOCKS - 1);
  const parts = blocks.slice(a, last + 1);
  const starts: number[] = [];
  let text = "";
  for (const p of parts) {
    if (text) text += "\n\n";
    starts.push(text.length);
    text += p.text.trimEnd(); // a comment's place at the end leaves a space
  }
  return {
    text,
    blocks: parts.length,
    cut: b > last,
    range(start, end) {
      let i = starts.length - 1;
      while (i > 0 && starts[i] > start) i--;
      const at = parts[i].at;
      const s = at[start - starts[i]];
      const e = at[end - 1 - starts[i]];
      return s === undefined || e === undefined ? null : { from: s, to: e + 1 };
    },
  };
}
