import { ORDERED_LIST_MARKER_PATTERN, OrderedList } from "@tiptap/extension-list";

// Tiptap's ordered list, minus a slow start. Its markdown tokenizer splits the
// whole rest of the document into lines at every block, just to see whether
// the first one is a list item, so parsing a long book took time growing with
// its length squared. The same test on the first line alone gives the same
// answer (its tokenizer gives up when that line isn't an item).
//
// Kept free of pen imports so tests can load it with plain Node.

// Tiptap's ORDERED_LIST_ITEM_REGEX (not exported).
const ITEM_RE = new RegExp(`^(\\s*)(${ORDERED_LIST_MARKER_PATTERN})([.)])\\s+(.*)$`);

const tokenizer = OrderedList.config.markdownTokenizer;
if (!tokenizer) throw new Error("@tiptap/extension-list internals changed: no markdownTokenizer");

export const PenOrderedList = OrderedList.extend({
  markdownTokenizer: {
    ...tokenizer,
    tokenize: (src, tokens, lexer) => {
      const nl = src.indexOf("\n");
      if (!ITEM_RE.test(nl < 0 ? src : src.slice(0, nl))) return undefined;
      return tokenizer.tokenize(src, tokens, lexer);
    },
  },
});
