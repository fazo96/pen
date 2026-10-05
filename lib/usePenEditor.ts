"use client";

import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Typography from "@tiptap/extension-typography";
import { Placeholder } from "@tiptap/extensions";
import { useRef } from "react";
import { CommentExtensions } from "./comments";
import { Find } from "./findPlugin";
import { Grammar } from "./grammar";
import { PenMarkdown } from "./markdownEscape";
import { PenOrderedList } from "./orderedList";
import { CitedPassage } from "./passage";
import { StraightQuotes } from "./quotes";
import { wordCount } from "./text";

// Heading names: the manuscript is structured (title, parts, chapters);
// codex entries are plain notes.
export const HEADINGS = {
  manuscript: ["Title", "Part", "Chapter"],
  entry: ["Title", "Heading", "Subheading"],
} as const;

/** A Tiptap editor set up for the manuscript or a codex entry. `onPaste` hears how many words were pasted. */
export function usePenEditor(
  kind: "manuscript" | "entry",
  content: string,
  onChange: () => void,
  onPaste?: (words: number) => void,
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
        heading: { levels: [1, 2, 3] },
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
      Grammar, // also sets spellcheck on the editor
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
        pasted.current?.(wordCount(slice.content.textBetween(0, slice.content.size, "\n\n", " ")));
        return false;
      },
    },
    onUpdate: ({ transaction }) => {
      if (transaction.docChanged) changed.current();
    },
  });
}
