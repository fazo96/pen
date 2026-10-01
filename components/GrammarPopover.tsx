"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { grammarKey, type ActiveFlag } from "@/lib/grammar";
import { grammar } from "@/lib/grammarClient";
import { ruleLabel, SPELLING_RULE } from "@/lib/grammarConfig";
import type { Suggestion } from "@/lib/grammarText";

const MAX_SUGGESTIONS = 5;

/** Harper writes `word`; the popover shows “word”. */
const plain = (message: string) => message.replace(/`([^`]*)`/g, "“$1”");

function suggestionLabel(s: Suggestion, problem: string) {
  if (s.kind === "remove") return `Remove “${problem.trim() || problem}”`;
  if (s.kind === "insert") return `Add “${s.text}”`;
  return s.text.trim() ? s.text : `“${s.text}”`;
}

/** What the grammar checker says about the flag last clicked in `editor`, with its fixes. */
export default function GrammarPopover({ editor }: { editor: Editor }) {
  const [active, setActive] = useState<ActiveFlag | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
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
  useLayoutEffect(() => {
    if (!active) return setPos(null);
    const place = () => {
      const el = box.current;
      if (!el || editor.isDestroyed) return;
      const start = editor.view.coordsAtPos(active.from);
      const end = editor.view.coordsAtPos(active.to, -1);
      const vv = window.visualViewport;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.max(8, Math.min(start.left, window.innerWidth - w - 8));
      const below = end.bottom + 6;
      setPos({ left, top: below + h > bottom - 8 && start.top - h - 6 > 8 ? start.top - h - 6 : below });
    };
    place();
    let frame = 0;
    const onMove = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !editor.view.dom.contains(t)) close();
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    window.visualViewport?.addEventListener("resize", onMove);
    document.addEventListener("pointerdown", onDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      window.visualViewport?.removeEventListener("resize", onMove);
      document.removeEventListener("pointerdown", onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, editor]);

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
    </div>,
    document.body,
  );
}
