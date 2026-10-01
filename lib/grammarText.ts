import type { Node as PMNode } from "@tiptap/pm/model";

// What the grammar checker reads, and what it says back. The checker sees one
// block of prose at a time: comments, inline code and code blocks are left
// out, and every character keeps its document position so flags land back on
// the right words.

export type Suggestion = { kind: "replace" | "remove" | "insert"; text: string };

/** One of Harper's flags, as plain data, spans in UTF-16 offsets into the block's text. */
export type Flag = {
  start: number;
  end: number;
  rule: string;
  kind: string;
  message: string;
  problem: string;
  suggestions: Suggestion[];
  /** Harper's context hash, what "Ignore" remembers. */
  hash: string;
};

export type TextBlock = {
  /** Before the block node. */
  pos: number;
  text: string;
  /** Document position of each character of `text`. */
  at: number[];
};

const SKIPPED_BLOCKS = new Set(["commentBlock", "codeBlock"]);
const SKIPPED_MARKS = new Set(["comment", "code"]);

/** The prose blocks of a document, in order. Blocks without letters are left out. */
export function textBlocks(doc: PMNode): TextBlock[] {
  const out: TextBlock[] = [];
  doc.descendants((node, pos) => {
    if (SKIPPED_BLOCKS.has(node.type.name)) return false;
    if (!node.isTextblock) return true;
    let text = "";
    const at: number[] = [];
    // A left-out run reads as one space: spaces on both sides of it collapse
    // into one, and it adds one only between two words.
    let gap = -1;
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText && !child.marks.some((m) => SKIPPED_MARKS.has(m.type.name))) {
        const t = child.text!;
        let i = 0;
        if (gap >= 0 && text) {
          if (/\s$/.test(text)) while (i < t.length && /\s/.test(t[i])) i++;
          else if (!/^\s/.test(t)) {
            text += " ";
            at.push(gap);
          }
        }
        gap = -1;
        for (; i < t.length; i++) {
          at.push(start + i);
          text += t[i];
        }
      } else if (child.type.name === "hardBreak") {
        gap = -1;
        at.push(start);
        text += "\n";
      } else if (gap < 0) {
        gap = start;
      }
    });
    if (/\p{L}/u.test(text)) out.push({ pos, text, at });
    return false;
  });
  return out;
}

/** The document range a flag covers, or null if it spans a left-out run. */
export function flagRange(block: TextBlock, flag: Flag): { from: number; to: number } | null {
  if (flag.end <= flag.start || flag.end > block.at.length) {
    // An insertion point (e.g. a missing comma) has no width: mark the word before it.
    if (flag.start === flag.end && flag.start > 0 && flag.start <= block.at.length) {
      const to = block.at[flag.start - 1] + 1;
      return { from: to - 1, to };
    }
    return null;
  }
  const from = block.at[flag.start];
  const to = block.at[flag.end - 1] + 1;
  return to - from === flag.end - flag.start ? { from, to } : null;
}
