import { Markdown, type MarkdownManager } from "@tiptap/markdown";
import type { JSONContent } from "@tiptap/core";

// How plain text is written to markdown.
//
// @tiptap/markdown escapes inline syntax (* _ ` [ ] ~ \) but not what starts a
// block, so a paragraph of dialogue opening "- Who's there?" was saved bare and
// came back as a list (likewise "2. ", "# ", "> "). It also wrote every & < >
// as an HTML entity. Here the inline escapes stay, entities are only used where
// markdown would otherwise read one, and a paragraph's line starts are guarded.
//
// Kept free of pen imports so tests can load it with plain Node.

// What would open a block at the start of a paragraph line: an ATX heading,
// quote, bullet, ordered item, or a setext underline / thematic break.
const BLOCK_START =
  /^( {0,3})(?:(#{1,6}|[-+])(?=[ \t]|$)|(>)|(\d{1,9})(?=[.)](?:[ \t]|$))|(=+|-+)(?=[ \t-]*$))/;

function escapeLineStart(line: string): string {
  return line.replace(BLOCK_START, (_m, ws: string, mark?: string, quote?: string, digits?: string, rule?: string) => {
    if (digits) return `${ws}${digits}\\`; // "2\. "
    return `${ws}\\${mark ?? quote ?? rule}`;
  });
}

/** Markdown for a run of plain (non-code) text; `atLineStart` when it begins a paragraph line. */
export function escapeText(text: string, atLineStart: boolean): string {
  const escaped = text
    .replace(/[\\`*_[\]~]/g, "\\$&")
    // Only what markdown would read as an entity or as HTML.
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, "&amp;")
    .replace(/<(?=[A-Za-z/!?])/g, "\\<")
    // Plain text that happens to hold "%%" must not become a pen comment.
    .replace(/%(?=%)/g, "%\\");
  const lines = escaped.split("\n");
  return lines.map((line, i) => (i > 0 || atLineStart ? escapeLineStart(line) : line)).join("\n");
}

type Encoder = (text: string, node: JSONContent, parent?: JSONContent) => string;
type ManagerInternals = { encodeTextForMarkdown?: Encoder; codeTypes?: Set<string> };

/** Does this text node begin a line of its paragraph (first child, or right after a hard break)? */
function startsLine(node: JSONContent, parent?: JSONContent): boolean {
  if (parent?.type !== "paragraph" || !parent.content) return false;
  const i = parent.content.indexOf(node);
  return i === 0 || (i > 0 && parent.content[i - 1].type === "hardBreak");
}

/** Swap this manager's text encoder for escapeText. Throws if tiptap's internals moved. */
export function installEscaping(manager: MarkdownManager): void {
  const m = manager as unknown as ManagerInternals;
  const codeTypes = m.codeTypes;
  if (typeof m.encodeTextForMarkdown !== "function" || !(codeTypes instanceof Set)) {
    throw new Error("@tiptap/markdown internals changed: encodeTextForMarkdown/codeTypes not found");
  }
  m.encodeTextForMarkdown = (text, node, parent) => {
    const isCode =
      (parent?.type != null && codeTypes.has(parent.type)) ||
      (node.marks ?? []).some((mark) => codeTypes.has(typeof mark === "string" ? mark : mark.type));
    return isCode ? text : escapeText(text, startsLine(node, parent));
  };
}

/** The Markdown extension with pen's text escaping. */
export const PenMarkdown = Markdown.extend({
  onBeforeCreate(event) {
    this.parent?.(event);
    installEscaping(this.storage.manager);
  },
});
