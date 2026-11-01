import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { Marked } from "marked";
import { lineSnippet } from "../cite";
import { CommentExtensions } from "../comments";
import { blockLines, plainText, textBlocks, type TextBlock } from "../grammarText";
import { PenOrderedList } from "../orderedList";

// Saved markdown read as the editor reads it, for Construct's checking tools
// (grammar_check, scan_prose): parsed into the editor's document, its prose
// blocks (comments and code left out, lib/grammarText.ts) each given the
// markdown line it starts on, for pen:L citations.

const extensions = [StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, orderedList: false }), PenOrderedList, ...CommentExtensions];
const schema = getSchema(extensions);
const markdown = new MarkdownManager({ marked: new Marked() as never, extensions });

export type ProseBlocks = {
  blocks: TextBlock[];
  /** Each block's first line (1-based). */
  starts: number[];
  /** Each block's node type ("paragraph", "heading"…). */
  types: string[];
  /** The markdown's lines as plain text, for finding a line within a block (lineOf). */
  plainLines: string[];
};

export function proseBlocks(md: string): ProseBlocks {
  const doc = schema.nodeFromJSON(markdown.parse(md));
  const blocks = textBlocks(doc);
  // lineSnippet skips lines under 3 characters; only blank ones should read as empty.
  const plainLines = md.split("\n").map((l) => plainText(lineSnippet(l, Infinity) ?? l));
  return {
    blocks,
    starts: blockLines(plainLines, blocks.map((b) => b.text)),
    types: blocks.map((b) => doc.nodeAt(b.pos)?.type.name ?? ""),
    plainLines,
  };
}
