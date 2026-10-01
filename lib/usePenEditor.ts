"use client";

import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Typography from "@tiptap/extension-typography";
import { Placeholder } from "@tiptap/extensions";
import { useRef } from "react";
import { CommentExtensions } from "./comments";
import { PenMarkdown } from "./markdownEscape";
import { CitedPassage } from "./passage";
import { StraightQuotes } from "./quotes";

// Heading names: the manuscript is structured (title, parts, chapters);
// codex entries are plain notes.
export const HEADINGS = {
  manuscript: ["Title", "Part", "Chapter"],
  entry: ["Title", "Heading", "Subheading"],
} as const;

/** A Tiptap editor set up for the manuscript or a codex entry. */
export function usePenEditor(kind: "manuscript" | "entry", content: string, onChange: () => void) {
  const isEntry = kind === "entry";
  const headingNames = HEADINGS[kind];
  const changed = useRef(onChange);
  changed.current = onChange;

  return useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false },
      }),
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
        spellcheck: "true",
        "aria-label": isEntry ? "Codex entry" : "Manuscript",
      },
    },
    onUpdate: ({ transaction }) => {
      if (transaction.docChanged) changed.current();
    },
  });
}
