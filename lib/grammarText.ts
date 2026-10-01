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

/** A flag where it sits in the document. */
export type PlacedFlag = { from: number; to: number; flag: Flag };

export type FlagSection<H> = { heading: H | null; items: PlacedFlag[] };

/** Flags (in document order) under the last heading before each; headings by position, in order. */
export function flagsByHeading<H extends { pos: number }>(items: PlacedFlag[], headings: H[]): FlagSection<H>[] {
  const out: FlagSection<H>[] = [];
  let h = -1;
  for (const item of items) {
    while (h + 1 < headings.length && headings[h + 1].pos < item.from) h++;
    const heading = h >= 0 ? headings[h] : null;
    if (out[out.length - 1]?.heading !== heading || !out.length) out.push({ heading, items: [] });
    out[out.length - 1].items.push(item);
  }
  return out;
}

export type RepeatedWord = { word: string; count: number; first: PlacedFlag };

/** Misspellings met at least `min` times, most frequent first. `key` says which spellings are the same word. */
export function repeatedWords(items: PlacedFlag[], rule: string, key: (w: string) => string, min = 2): RepeatedWord[] {
  const byKey = new Map<string, RepeatedWord>();
  for (const item of items) {
    if (item.flag.rule !== rule) continue;
    const k = key(item.flag.problem);
    const seen = byKey.get(k);
    if (seen) seen.count++;
    else byKey.set(k, { word: item.flag.problem.replace(/['’]s$/i, ""), count: 1, first: item });
  }
  return [...byKey.values()].filter((w) => w.count >= min).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}
