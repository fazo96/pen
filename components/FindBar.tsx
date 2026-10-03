"use client";

import { type Editor, useEditorState } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import type { FindOptions } from "@/lib/find";
import { clearSearch, findState, replaceAll, replaceCurrent, selectCurrent, setSearch, step } from "@/lib/findPlugin";
import { useKeys } from "@/lib/useKeys";
import { IconClose, IconDown, IconUp } from "./icons";

export type FindMode = "find" | "replace";

type Props = {
  /** The editor searched: the manuscript's or the Codex panel's. */
  editor: Editor;
  mode: FindMode;
  /** Bumped (Ctrl+F again) to put the cursor back in the query, selected. */
  focusKey: number;
  onMode: (mode: FindMode) => void;
  /** `refocus`: put the cursor in the text, on the match. */
  onClose: (refocus: boolean) => void;
  onReplaced: (count: number) => void;
};

// Kept for the next opening on this page, unless the selection gives another.
let lastQuery = "";
let lastOptions: FindOptions = { caseSensitive: false, wholeWord: false };

/** The selection, when it's short enough to be what you'd look for. */
function selected(editor: Editor): string | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const text = editor.state.doc.textBetween(from, to, "\n");
  return text.length <= 100 && !text.includes("\n") ? text : null;
}

/** Ctrl+F / Ctrl+H: find (and replace) in one editor. */
export default function FindBar({ editor, mode, focusKey, onMode, onClose, onReplaced }: Props) {
  const [query, setQuery] = useState(() => selected(editor) ?? lastQuery);
  const [replacement, setReplacement] = useState("");
  const [options, setOptions] = useState(lastOptions);
  const input = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const keys = useKeys();

  const { count, current, more } = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const s = findState(e.state);
      return { count: s.matches.length, current: s.current, more: s.more };
    },
  });

  useEffect(() => {
    lastQuery = query;
    lastOptions = options;
    if (!editor.isDestroyed) setSearch(editor.view, query, options);
  }, [editor, query, options]);
  useEffect(() => () => void (!editor.isDestroyed && clearSearch(editor.view)), [editor]);

  // Opening, or Ctrl+F again: the selection (if any) becomes the query, ready to type over.
  const opened = useRef(focusKey);
  useEffect(() => {
    if (opened.current !== focusKey) {
      opened.current = focusKey;
      const sel = selected(editor);
      if (sel) setQuery(sel);
    }
    const el = mode === "replace" && query ? replaceInput.current : input.current;
    el?.focus();
    el?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, mode]);

  const close = (refocus: boolean) => {
    if (!editor.isDestroyed) {
      if (refocus) selectCurrent(editor.view);
      else clearSearch(editor.view);
    }
    onClose(refocus);
  };
  const go = (dir: 1 | -1) => !editor.isDestroyed && step(editor.view, dir);
  const replaceOne = () => !editor.isDestroyed && replaceCurrent(editor.view, replacement);
  const replaceEvery = () => {
    if (editor.isDestroyed) return;
    onReplaced(replaceAll(editor.view, replacement));
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, enter: (shift: boolean) => void) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      // Not focus mode's Esc as well.
      e.stopPropagation();
      close(true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      enter(e.shiftKey);
    }
  };

  const total = more ? `${count}+` : String(count);
  const counter = !query.trim() ? "" : count ? `${current + 1} of ${total}` : "No results";
  const toggle = (k: keyof FindOptions) => setOptions((o) => ({ ...o, [k]: !o[k] }));
  // Keep the cursor in the input (and the phone's keyboard up).
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="find-bar" role="search" aria-label={mode === "replace" ? "Find and replace" : "Find"}>
      <div className="find-row">
        <button
          type="button"
          className={`icon-btn find-expand ${mode === "replace" ? "is-on" : ""}`}
          onMouseDown={keep}
          onClick={() => onMode(mode === "replace" ? "find" : "replace")}
          aria-label="Replace"
          aria-expanded={mode === "replace"}
          title={keys.title("Replace", "replace")}
        >
          <IconDown />
        </button>
        <input
          ref={input}
          className="find-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => onKey(e, (shift) => go(shift ? -1 : 1))}
          placeholder="Find"
          aria-label="Find"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
        />
        <span className="find-count label" aria-live="polite">
          {counter}
        </span>
        <button
          type="button"
          className={`find-option ${options.caseSensitive ? "is-on" : ""}`}
          onMouseDown={keep}
          onClick={() => toggle("caseSensitive")}
          aria-pressed={options.caseSensitive}
          aria-label="Match case"
          title="Match case"
        >
          Aa
        </button>
        <button
          type="button"
          className={`find-option find-option-word ${options.wholeWord ? "is-on" : ""}`}
          onMouseDown={keep}
          onClick={() => toggle("wholeWord")}
          aria-pressed={options.wholeWord}
          aria-label="Whole word"
          title="Whole word"
        >
          ab
        </button>
        <button
          type="button"
          className="icon-btn"
          onMouseDown={keep}
          onClick={() => go(-1)}
          disabled={!count}
          aria-label="Previous match"
          title={keys.title("Previous match", "findPrevious")}
        >
          <IconUp />
        </button>
        <button
          type="button"
          className="icon-btn"
          onMouseDown={keep}
          onClick={() => go(1)}
          disabled={!count}
          aria-label="Next match"
          title={keys.title("Next match", "findNext")}
        >
          <IconDown />
        </button>
        <button type="button" className="icon-btn" onClick={() => close(true)} aria-label="Close" title="Close (Esc)">
          <IconClose />
        </button>
      </div>
      {mode === "replace" && (
        <div className="find-row find-replace">
          <input
            ref={replaceInput}
            className="find-input"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => onKey(e, () => replaceOne())}
            placeholder="Replace with"
            aria-label="Replace with"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
          />
          <button type="button" className="find-action" onMouseDown={keep} onClick={replaceOne} disabled={!count}>
            Replace
          </button>
          <button type="button" className="find-action" onMouseDown={keep} onClick={replaceEvery} disabled={!count}>
            All
          </button>
        </div>
      )}
    </div>
  );
}
