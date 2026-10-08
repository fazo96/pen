"use client";

import type { Fragment } from "@tiptap/pm/model";
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Typography from "@tiptap/extension-typography";
import { Placeholder } from "@tiptap/extensions";
import { useRef } from "react";
import { CommentExtensions } from "./comments";
import { Find } from "./findPlugin";
import { CODEX_GRAMMAR, Grammar } from "./grammar";
import { PenMarkdown } from "./markdownEscape";
import { PenOrderedList } from "./orderedList";
import { CitedPassage } from "./passage";
import { StraightQuotes } from "./quotes";
import { wordCount } from "./text";

// Heading names: the manuscript is structured (title, parts, chapters, scenes);
// codex entries are plain notes.
export const HEADINGS = {
  manuscript: ["Title", "Part", "Chapter", "Scene"],
  entry: ["Title", "Heading", "Subheading", "Minor heading"],
} as const;

const textOf = (fragment: Fragment) => fragment.textBetween(0, fragment.size, "\n\n", " ");
/** A text's words, to tell a paste of what was cut from any other. */
const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";

// The last text cut in any of this page's editors (the manuscript, the Codex
// panel), until it's pasted: pasting it back is moving it, not adding to it.
let lastCut: string | null = null;

/**
 * A Tiptap editor set up for the manuscript or a codex entry. `onPaste` hears
 * how many words were pasted, and whether they were cut here (`moved`).
 */
export function usePenEditor(
  kind: "manuscript" | "entry",
  content: string,
  onChange: () => void,
  onPaste?: (words: number, moved: boolean) => void,
) {
  const isEntry = kind === "entry";
  const headingNames = HEADINGS[kind];
  const changed = useRef(onChange);
  changed.current = onChange;
  const pasted = useRef(onPaste);
  pasted.current = onPaste;

  return useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        link: { openOnClick: false },
        orderedList: false,
      }),
      PenOrderedList,
      PenMarkdown,
      ...CommentExtensions,
      Typography.configure({
        // Keep dashes and ellipses; drop the ones that ambush prose. Quotes stay
        // straight (see StraightQuotes).
        openDoubleQuote: false,
        closeDoubleQuote: false,
        openSingleQuote: false,
        closeSingleQuote: false,
        oneHalf: false,
        oneQuarter: false,
        threeQuarters: false,
        plusMinus: false,
        notEqual: false,
        multiplication: false,
        superscriptTwo: false,
        superscriptThree: false,
        leftArrow: false,
        rightArrow: false,
        copyright: false,
        registeredTrademark: false,
        trademark: false,
        servicemark: false,
        laquo: false,
        raquo: false,
      }),
      StraightQuotes,
      CitedPassage,
      Find,
      Grammar.configure({ check: !isEntry || CODEX_GRAMMAR }), // also sets spellcheck on the editor
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "commentBlock"
            ? "Comment"
            : node.type.name === "heading"
            ? (headingNames[(node.attrs.level as number) - 1] ?? "Heading")
            : "Begin anywhere…",
      }),
    ],
    content,
    contentType: "markdown",
    editorProps: {
      attributes: {
        class: isEntry ? "prose is-notes" : "prose",
        "aria-label": isEntry ? "Codex entry" : "Manuscript",
      },
      // Counted for the writing stats, where pasted words aren't writing; the paste itself goes ahead.
      handlePaste: (_view, _event, slice) => {
        const text = textOf(slice.content);
        const moved = lastCut !== null && wordsOf(text) === lastCut;
        if (moved) lastCut = null; // pasting it again copies it
        pasted.current?.(wordCount(text), moved);
        return false;
      },
      handleDOMEvents: {
        cut: (view) => {
          // Right after the selection changes the editor may not have caught up
          // (it then leaves the cut to the browser): the page's selection is.
          const { selection } = view.state;
          const text = selection.empty ? (view.dom.ownerDocument.getSelection()?.toString() ?? "") : textOf(selection.content().content);
          lastCut = wordsOf(text) || null;
          return false;
        },
      },
    },
    onUpdate: ({ transaction }) => {
      if (transaction.docChanged) changed.current();
    },
  });
}
