"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { grammarKey, type ActiveFlag } from "@/lib/grammar";
import { grammar } from "@/lib/grammarClient";
import { ruleLabel, SPELLING_RULE } from "@/lib/grammarConfig";
import type { Suggestion } from "@/lib/grammarText";
import { useAnchored } from "@/lib/useAnchored";
import { IconConstruct } from "./icons";
import { grammarPrompt } from "@/lib/wordTools";

const MAX_SUGGESTIONS = 5;

/** Harper writes `word`; the popover shows “word”. */
const plain = (message: string) => message.replace(/`([^`]*)`/g, "“$1”");

function suggestionLabel(s: Suggestion, problem: string) {
  if (s.kind === "remove") return `Remove “${problem.trim() || problem}”`;
  if (s.kind === "insert") return `Add “${s.text}”`;
  return s.text.trim() ? s.text : `“${s.text}”`;
}

/** What the grammar checker says about the flag last clicked in `editor`, with its fixes. */
export default function GrammarPopover({ editor, onAsk }: { editor: Editor; onAsk?: (text: string, range: { from: number; to: number }) => void }) {
  const [active, setActive] = useState<ActiveFlag | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setActive(grammarKey.getState(editor.state)?.active ?? null);
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);

  const close = () => {
    if (editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(grammarKey, { active: null }).setMeta("addToHistory", false));
  };

  // Under the flagged words, or above them when there's no room below.
  const pos = useAnchored(editor, active, box, { onOutside: close });

  if (!active) return null;
  const { flag, from, to } = active;
  const spelling = flag.rule === SPELLING_RULE;

  const fix = (s: Suggestion) => {
    const { tr } = editor.state;
    if (s.kind === "remove") tr.delete(from, to);
    else if (s.kind === "insert") tr.insertText(s.text, to);
    else tr.insertText(s.text, from, to);
    editor.view.dispatch(tr);
    editor.view.focus();
  };
  const act = (patch: Parameters<typeof grammar.update>[0]) => {
    close();
    void grammar.update(patch);
  };

  return createPortal(
    <div
      ref={box}
      className="popover-menu grammar-popover"
      role="dialog"
      aria-label="Grammar suggestion"
      style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
      // Keep the editor's selection (and the phone keyboard) where they are.
      onMouseDown={(e) => e.preventDefault()}
    >
      <p className="grammar-message">
        <span className="label">{ruleLabel(flag.kind)}</span>
        {plain(flag.message)}
      </p>
      {flag.suggestions.slice(0, MAX_SUGGESTIONS).map((s, i) => (
        <button key={i} type="button" className="grammar-fix" onClick={() => fix(s)}>
          {suggestionLabel(s, flag.problem)}
        </button>
      ))}
      {spelling && (
        <button type="button" onClick={() => act({ addWord: flag.problem.replace(/['’]s$/i, "") })}>
          Add to dictionary
        </button>
      )}
      <button type="button" onClick={() => act({ ignore: flag.hash })}>
        Ignore
      </button>
      {!spelling && (
        <button type="button" onClick={() => act({ rule: { name: flag.rule, on: false } })}>
          Turn off this rule
        </button>
      )}
      {onAsk && (
        <button
          type="button"
          className="grammar-ask"
          onClick={() => {
            close();
            onAsk(
              grammarPrompt(
                flag.problem,
                spelling ? "spelling" : ruleLabel(flag.rule),
                plain(flag.message),
                flag.suggestions.filter((s) => s.kind !== "remove").map((s) => s.text),
              ),
              { from, to },
            );
          }}
        >
          <IconConstruct /> Ask Construct
        </button>
      )}
    </div>,
    document.body,
  );
}
