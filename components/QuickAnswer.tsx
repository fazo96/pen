"use client";

import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PromptContext } from "@/lib/construct/types";
import { useAnchored, useCloseOnEdit } from "@/lib/useAnchored";
import { useQuickAnswer } from "@/lib/useQuickAnswer";
import { alternativesIn, matchCase, type QuickKind } from "@/lib/wordTools";
import { Markdown } from "./ConstructMarkdown";
import { IconClose, IconConstruct } from "./icons";

export type Quick = {
  /** A new one each time. */
  id: number;
  editor: Editor;
  from: number;
  to: number;
  /** The selected text, to check it's still there before replacing it. */
  text: string;
  prompt: string;
  context: PromptContext;
  kind?: QuickKind;
};

/**
 * A look-up or grammar button's question, answered once by the quick-action
 * model, outside the chat (POST /api/docs/<id>/construct/quick), in a popover
 * over the selection. Synonyms offered can replace it; "Continue in
 * Construct" asks the chat instead. Closing it stops the answer.
 */
export default function QuickAnswer({
  projectId,
  quick,
  onClose,
  onContinue,
}: {
  projectId: string;
  quick: Quick;
  onClose: () => void;
  onContinue: () => void;
}) {
  const { editor } = quick;
  const { answer, status, error } = useQuickAnswer(projectId, useMemo(() => ({ prompt: quick.prompt, context: quick.context }), [quick]));
  const box = useRef<HTMLDivElement>(null);
  const [range] = useState(() => ({ from: quick.from, to: quick.to }));
  const pos = useAnchored(editor, range, box, { onOutside: onClose });

  useCloseOnEdit(editor, onClose, range);

  const replace = (word: string) => {
    const { state } = editor;
    if (state.doc.textBetween(range.from, range.to, " ", " ") !== quick.text) return onClose();
    const text = matchCase(word, quick.text);
    const tr = state.tr.insertText(text, range.from, range.to);
    // Selected, since the form (tense, plural) may need adjusting by hand.
    tr.setSelection(TextSelection.create(tr.doc, range.from, range.from + text.length));
    editor.view.dispatch(tr);
    editor.view.focus();
  };

  const offered = quick.kind === "synonyms" && status === "done" ? alternativesIn(answer) : [];

  return createPortal(
    <div
      ref={box}
      className="popover-menu lookup quick"
      role="dialog"
      aria-label="Construct’s answer"
      aria-busy={status === "asking" || status === "slow"}
      style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button type="button" className="icon-btn lookup-close" onClick={onClose} aria-label="Close">
        <IconClose />
      </button>
      <div className="lookup-body">
        {offered.length > 0 && (
          <div className="lookup-row quick-chips">
            {offered.map((w) => (
              <button key={w} type="button" className="lookup-chip" onClick={() => replace(w)} title={`Replace with “${w}”`}>
                {w}
              </button>
            ))}
          </div>
        )}
        {answer && <Markdown text={answer} />}
        {!answer && status === "asking" && <p className="lookup-note">Asking Construct…</p>}
        {!answer && status === "slow" && (
          <p className="lookup-note">Waiting for the model… a self-hosted one may still be loading.</p>
        )}
        {error && (
          <p className="lookup-note" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="lookup-foot">
        <IconConstruct aria-label="Construct" />
        <button type="button" onClick={onContinue}>
          Continue in Construct
        </button>
      </div>
    </div>,
    document.body,
  );
}
