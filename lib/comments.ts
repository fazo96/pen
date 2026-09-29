import { InputRule, Mark, type MarkdownTokenizer, mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

// Markdown comments as first-class editor content.
//
//   %% note %%        Obsidian style: the default for new comments
//   <!-- note -->     HTML style: recognised and kept as written
//
// A comment alone in its block becomes a CommentBlock; inside a sentence it is
// text carrying the Comment mark. Both are `code`, so their text is written
// back verbatim (no escaping) and typing shortcuts don't touch it. The space
// or newline just inside the delimiters is kept in `lead`/`trail` so files
// round-trip exactly.

export type CommentSyntax = "percent" | "html";

const DELIMS: Record<CommentSyntax, [string, string]> = {
  percent: ["%%", "%%"],
  html: ["<!--", "-->"],
};

const DEFAULT_ATTRS = { syntax: "percent" as CommentSyntax, lead: " ", trail: " " };

/** Split raw inner text into the kept padding and the visible text. */
function unpad(inner: string) {
  const lead = /^[ \n]/.test(inner) ? inner[0] : "";
  const rest = inner.slice(lead.length);
  const trail = rest.length > 0 && /[ \n]$/.test(rest) ? rest[rest.length - 1] : "";
  return { lead, trail, text: trail ? rest.slice(0, -1) : rest };
}

function wrap(attrs: { syntax?: CommentSyntax; lead?: string; trail?: string }, text: string) {
  const [open, close] = DELIMS[attrs.syntax ?? "percent"];
  return `${open}${attrs.lead ?? " "}${text}${attrs.trail ?? " "}${close}`;
}

const commentAttributes = {
  syntax: { default: "percent", rendered: false },
  lead: { default: " ", rendered: false },
  trail: { default: " ", rendered: false },
};

// A block comment fills whole lines (possibly several); an inline one sits in text.
// The inner text may not contain its own closing delimiter, so a block ends at
// the first one: "%% a %% prose" is an inline comment, never a block spanning
// to some later "%%" at a line end.
const BLOCK_RE = /^ {0,3}(?:%%((?:(?!%%)[\s\S])*)%%|<!--((?:(?!-->)[\s\S])*)-->)[ \t]*(?:\n+|$)/;
const INLINE_RE = /^(?:%%([\s\S]+?)%%|<!--([\s\S]*?)-->)/;

function firstOpening(src: string) {
  const i = [src.indexOf("%%"), src.indexOf("<!--")].filter((n) => n >= 0);
  return i.length ? Math.min(...i) : -1;
}

// Where a block comment could begin: only a comment filling its own line.
// (Reporting any "<!--" would let the parser cut a paragraph mid-sentence.)
const BLOCK_START_RE = /(?:^|\n) {0,3}(?:%%(?:(?!%%)[\s\S])*%%|<!--(?:(?!-->)[\s\S])*-->)[ \t]*(?:\n|$)/;
function blockStart(src: string) {
  const m = BLOCK_START_RE.exec(src);
  if (!m) return -1;
  return m[0].startsWith("\n") ? m.index + 1 : m.index;
}

function tokenizer(level: "block" | "inline"): MarkdownTokenizer {
  const name = level === "block" ? "commentBlock" : "comment";
  return {
    name,
    level,
    start: level === "block" ? blockStart : firstOpening,
    tokenize: (src, _tokens, lexer) => {
      const m = (level === "block" ? BLOCK_RE : INLINE_RE).exec(src);
      if (!m) {
        // A paragraph that merely *starts* with "<!--" would otherwise be taken
        // as a raw HTML block and its comment dropped. Claim it here and let
        // parseMarkdown turn it into a paragraph. (It must not be typed
        // "paragraph": marked would then merge the next paragraph into it.)
        const para = level === "block" && /^ {0,3}<!--/.test(src) && /^([^\n]+(?:\n(?![ \t]*\n)[^\n]*)*)(?:\n+|$)/.exec(src);
        if (!para) return undefined;
        return { type: name, raw: para[0], text: para[1], asParagraph: true, tokens: lexer.inlineTokens(para[1]) };
      }
      const syntax: CommentSyntax = m[1] !== undefined ? "percent" : "html";
      return { type: name, raw: m[0], syntax, inner: m[1] ?? m[2] };
    },
  };
}

export const CommentBlock = Node.create({
  name: "commentBlock",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,

  addAttributes: () => commentAttributes,
  parseHTML: () => [{ tag: "div[data-comment]", preserveWhitespace: "full" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-comment": "", class: "comment-block" }), 0],

  markdownTokenName: "commentBlock",
  markdownTokenizer: tokenizer("block"),
  parseMarkdown: (token, h) => {
    if (token.asParagraph) return h.createNode("paragraph", {}, h.parseInline(token.tokens ?? []));
    const { lead, trail, text } = unpad(String(token.inner ?? ""));
    return h.createNode("commentBlock", { syntax: token.syntax, lead, trail }, text ? [{ type: "text", text }] : []);
  },
  renderMarkdown: (node) => wrap(node.attrs ?? {}, (node.content ?? []).map((c) => c.text ?? "").join("")),

  addKeyboardShortcuts() {
    return {
      // Enter at the end of a comment leaves it; Shift+Enter adds a line inside.
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if ($from.parent.type.name !== this.name || !empty || $from.parentOffset < $from.parent.content.size) return false;
        const after = $from.after();
        const next = editor.state.doc.resolve(after).nodeAfter;
        // Reuse an empty paragraph that's already there (e.g. the trailing one).
        if (next?.type.name === "paragraph" && next.content.size === 0) {
          return editor.commands.setTextSelection(after + 1);
        }
        return editor.chain().insertContentAt(after, { type: "paragraph" }).setTextSelection(after + 1).run();
      },
      "Shift-Enter": ({ editor }) =>
        editor.state.selection.$from.parent.type.name === this.name && editor.commands.insertContent("\n"),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comment: {
      /** Selection → inline comment; nothing selected → the block becomes (or stops being) a comment. */
      toggleComment: () => ReturnType;
    };
  }
}

export const Comment = Mark.create({
  name: "comment",
  code: true,
  excludes: "_",
  inclusive: false,
  exitable: true,

  addAttributes: () => commentAttributes,
  parseHTML: () => [{ tag: "span[data-comment]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-comment": "", class: "comment-inline" }), 0],

  markdownTokenName: "comment",
  markdownTokenizer: tokenizer("inline"),
  parseMarkdown: (token, h) => {
    const { lead, trail, text } = unpad(String(token.inner ?? ""));
    if (!text) return [];
    return h.applyMark("comment", [{ type: "text", text }], { syntax: token.syntax, lead, trail });
  },
  renderMarkdown: (node, h) => wrap(node.attrs ?? {}, h.renderChildren(node)),

  addCommands() {
    return {
      toggleComment:
        () =>
        ({ state, chain }) => {
          const { empty, $from, $to } = state.selection;
          if (!empty && $from.sameParent($to) && $from.parent.type.name !== "commentBlock") {
            return chain().focus().toggleMark(this.name, DEFAULT_ATTRS).run();
          }
          if ($from.parent.type.name === "commentBlock") return chain().focus().setNode("paragraph").run();
          return chain().focus().setNode("commentBlock", DEFAULT_ATTRS).run();
        },
    };
  },

  // Typing "%% note %%" or "<!-- note -->" turns it into a comment.
  addInputRules() {
    return (["percent", "html"] as const).map(
      (syntax) =>
        new InputRule({
          find: syntax === "percent" ? /%%([^%\n]+)%%$/ : /<!--([^\n]*?)-->$/,
          handler: ({ state, range, match }) => {
            const { lead, trail, text } = unpad(match[1]);
            if (!text) return;
            const mark = this.type.create({ syntax, lead, trail });
            state.tr.replaceWith(range.from, range.to, state.schema.text(text, [mark])).removeStoredMark(this.type);
          },
        }),
    );
  },
});

export const CommentExtensions = [CommentBlock, Comment];

/** A node's text without its comments (for word counts and heading titles). */
export function textWithoutComments(node: PMNode): string {
  let out = "";
  node.descendants((n) => {
    if (n.type.name === "commentBlock") return false;
    if (n.isText) {
      if (!n.marks.some((m) => m.type.name === "comment")) out += n.text;
    } else if (n.isBlock || n.isLeaf) {
      out += " ";
    }
    return true;
  });
  return out;
}
