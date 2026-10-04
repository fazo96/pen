"use client";

import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PromptContext } from "@/lib/construct/types";
import { readNdjson } from "@/lib/ndjson";
import { useAnchored } from "@/lib/useAnchored";
import { alternativesIn, matchCase, type QuickKind } from "@/lib/wordTools";
import { Markdown } from "./Construct";
import { IconConstruct } from "./icons";

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

type Line = { t: "text"; text: string } | { t: "done" } | { t: "error"; error: string };

// A self-hosted model may be loading: say so if nothing has come by then.
const SLOW_MS = 10_000;

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
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<"asking" | "slow" | "done" | "error">("asking");
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [range] = useState(() => ({ from: quick.from, to: quick.to }));
  const pos = useAnchored(editor, range, box, { onOutside: onClose });

  useEffect(() => {
    const ctrl = new AbortController();
    const slow = setTimeout(() => setStatus((s) => (s === "asking" ? "slow" : s)), SLOW_MS);
    (async () => {
      const res = await fetch(`/api/docs/${projectId}/construct/quick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: quick.prompt, context: quick.context }),
        signal: ctrl.signal,
      });
      if (res.status === 401) throw new Error("Locked. Unlock pen to ask Construct.");
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn’t ask Construct.");
      let ended = false;
      await readNdjson<Line>(res, (line) => {
        if (line.t === "text") {
          clearTimeout(slow);
          setAnswer((a) => a + line.text);
          setStatus((s) => (s === "slow" ? "asking" : s));
        } else if (line.t === "done") {
          ended = true;
          setStatus("done");
        } else if (line.t === "error") {
          ended = true;
          setError(line.error);
          setStatus("error");
        }
      });
      if (!ended) throw new Error("The answer was cut off.");
    })()
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message || "Couldn’t reach pen.");
        setStatus("error");
      })
      .finally(() => clearTimeout(slow));
    return () => {
      ctrl.abort();
      clearTimeout(slow);
    };
  }, [projectId, quick]);

  // Typing elsewhere, or moving the words, closes it.
  useEffect(() => {
    const onTx = ({ transaction }: { transaction: { docChanged: boolean } }) => transaction.docChanged && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    editor.on("transaction", onTx);
    window.addEventListener("keydown", onKey);
    return () => {
      editor.off("transaction", onTx);
      window.removeEventListener("keydown", onKey);
    };
  }, [editor, onClose]);

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
