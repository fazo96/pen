"use client";

import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { grammarKey } from "@/lib/grammar";
import { useAnchored } from "@/lib/useAnchored";
import { askDraft, constructPrompt, onLookUpRequest, pickedWords, type AskKind, type Picked } from "@/lib/wordTools";
import { inflectLike, type Pos } from "@/lib/wordforms";
import { IconBook, IconConstruct } from "./icons";

export type Ask = (text: string, range: { from: number; to: number }, send: boolean) => void;

type Sense = {
  pos: Pos;
  definition: string;
  examples: string[];
  synonyms: string[];
  similar: string[];
  broader: string[];
  narrower: string[];
  opposites: string[];
  irregular: string[];
};
type Entry = { lemma: string; pronunciation?: string; via: "same" | "regular" | "irregular"; senses: Sense[] };
type Result = { entries: Entry[] } | { error: string } | null;

const POS_NAME: Record<Pos, string> = { n: "noun", v: "verb", a: "adjective", s: "adjective", r: "adverb" };
// Meanings shown before "More": the first word's, then any others'.
const SHOWN_FIRST = 4;
const SHOWN_OTHERS = 2;
// WordNet's synonym sets are strict ("walk" has almost none), so when a meaning
// has few, its more specific words (stroll, amble, trudge…) show from the start.
const FEW_SYNONYMS = 3;
const SPECIFIC_SHOWN = 24;

// Only where there's a mouse: on phones the selection has the system's own
// menu, and these actions live in the toolbar instead.
const finePointer = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/**
 * For a selected word or short phrase: a small bar over it (desktop) with Look
 * up and the Construct questions, and the Look up popover with its meanings
 * and synonyms. A synonym replaces the selection, in the same form.
 */
export default function WordTools({ editor, onAsk }: { editor: Editor; onAsk: Ask }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [lookUp, setLookUp] = useState<Picked | null>(null);
  const [pressing, setPressing] = useState(false);
  const bar = useRef<HTMLDivElement>(null);

  // Follow the selection; the bar waits until the mouse is let go.
  useEffect(() => {
    const sync = () => {
      const { state } = editor;
      const next = editor.isFocused && !grammarKey.getState(state)?.active ? pickedWords(state) : null;
      setPicked((p) => (p && next && p.from === next.from && p.to === next.to ? p : next));
    };
    const down = () => setPressing(true);
    const up = () => setPressing(false);
    editor.on("selectionUpdate", sync);
    editor.on("transaction", sync);
    editor.on("blur", sync);
    // Kept for the cleanup: by then a panel's editor may be destroyed, and its
    // `view` throws.
    const dom = editor.view.dom;
    dom.addEventListener("mousedown", down);
    window.addEventListener("mouseup", up);
    return () => {
      editor.off("selectionUpdate", sync);
      editor.off("transaction", sync);
      editor.off("blur", sync);
      dom.removeEventListener("mousedown", down);
      window.removeEventListener("mouseup", up);
    };
  }, [editor]);

  // The toolbar's Look up (phones).
  useEffect(
    () =>
      onLookUpRequest((ed) => {
        if (ed !== editor) return;
        const p = pickedWords(editor.state);
        if (p) setLookUp(p);
      }),
    [editor],
  );

  // Ctrl/Cmd+Shift+D looks up the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.key.toLowerCase() !== "d") return;
      const p = editor.isFocused ? pickedWords(editor.state) : null;
      if (!p) return;
      e.preventDefault();
      setLookUp(p);
    };
    const dom = editor.view.dom;
    dom.addEventListener("keydown", onKey);
    return () => dom.removeEventListener("keydown", onKey);
  }, [editor]);

  const showBar = !!picked && !pressing && !lookUp && typeof window !== "undefined" && finePointer();
  const barPos = useAnchored(editor, showBar ? picked : null, bar, { above: true });

  const ask = (kind: AskKind | "ask", p: Picked) => {
    setLookUp(null);
    if (kind === "ask") onAsk(askDraft(p.text), p, false);
    else onAsk(constructPrompt(kind, p.text), p, true);
  };

  return (
    <>
      {showBar &&
        createPortal(
          <div
            ref={bar}
            className="popover-menu word-bar"
            role="toolbar"
            aria-label="Selected words"
            style={barPos ? { left: barPos.left, top: barPos.top } : { visibility: "hidden" }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <button type="button" onClick={() => setLookUp(picked)} title="Look up (Ctrl+Shift+D)">
              <IconBook /> Look up
            </button>
            <span className="word-bar-sep" aria-hidden />
            <IconConstruct className="word-bar-construct" aria-label="Construct" />
            <button type="button" onClick={() => ask("synonyms", picked!)}>
              Synonyms
            </button>
            <button type="button" onClick={() => ask("meaning", picked!)}>
              Meaning
            </button>
            <button type="button" onClick={() => ask("ask", picked!)}>
              Ask…
            </button>
          </div>,
          document.body,
        )}
      {lookUp && <LookUp editor={editor} picked={lookUp} onClose={() => setLookUp(null)} onAsk={(k) => ask(k, lookUp)} />}
    </>
  );
}

function LookUp({
  editor,
  picked,
  onClose,
  onAsk,
}: {
  editor: Editor;
  picked: Picked;
  onClose: () => void;
  onAsk: (kind: AskKind) => void;
}) {
  const [result, setResult] = useState<Result>(null);
  const [more, setMore] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pos = useAnchored(editor, picked, box, { onOutside: onClose });

  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 1500);
    fetch(`/api/dictionary?word=${encodeURIComponent(picked.text)}`, { signal: ctrl.signal })
      .then(async (res) => setResult(res.ok ? await res.json() : { error: (await res.json().catch(() => ({}))).error ?? "Look-up failed." }))
      .catch((err) => (err as Error).name !== "AbortError" && setResult({ error: "Can’t reach pen." }))
      .finally(() => clearTimeout(timer));
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [picked.text]);

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

  const replace = (word: string, entry: Entry, sense: Sense) => {
    const { state } = editor;
    if (state.doc.textBetween(picked.from, picked.to, " ", " ") !== picked.text) return onClose();
    const formed = inflectLike(word, entry.lemma, picked.text, sense.pos, sense.irregular.includes(word));
    const text = formed ?? word;
    const tr = state.tr.insertText(text, picked.from, picked.to);
    // An irregular form couldn't be carried over: leave the word selected to adjust.
    const end = picked.from + text.length;
    tr.setSelection(TextSelection.create(tr.doc, formed ? end : picked.from, end));
    editor.view.dispatch(tr);
    editor.view.focus();
  };

  const entries = result && "entries" in result ? result.entries : [];
  const chips = (label: string, words: string[], entry: Entry, sense: Sense) =>
    words.length > 0 && (
      <div className="lookup-row">
        <span className="lookup-row-label">{label}</span>
        {words.map((w) => (
          <button key={w} type="button" className="lookup-chip" onClick={() => replace(w, entry, sense)}>
            {w}
          </button>
        ))}
      </div>
    );

  return createPortal(
    <div
      ref={box}
      className="popover-menu lookup"
      role="dialog"
      aria-label={`Look up ${picked.text}`}
      style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="lookup-body">
        {!result && (
          <p className="lookup-note">
            {slow ? "Getting the dictionary ready: the first look-up downloads it…" : `Looking up “${picked.text}”…`}
          </p>
        )}
        {result && "error" in result && <p className="lookup-note">{result.error}</p>}
        {result && "entries" in result && !entries.length && (
          <p className="lookup-note">“{picked.text}” isn’t in the dictionary.</p>
        )}
        {entries.map((entry, ei) => (
          <section key={entry.lemma} className="lookup-entry">
            <h3 className="lookup-word">
              {entry.lemma}
              {entry.pronunciation && <span className="lookup-pron">/{entry.pronunciation}/</span>}
              {entry.via !== "same" && <span className="lookup-via">for “{picked.text}”</span>}
            </h3>
            {entry.senses.slice(0, more ? undefined : ei === 0 ? SHOWN_FIRST : SHOWN_OTHERS).map((sense, i) => (
                <div key={i} className="lookup-sense">
                  <p className="lookup-def">
                    <span className="label">{POS_NAME[sense.pos]}</span> {sense.definition}
                  </p>
                  {sense.examples[0] && <p className="lookup-example">“{sense.examples[0]}”</p>}
                  {chips("Same", sense.synonyms, entry, sense)}
                  {chips("Similar", sense.similar, entry, sense)}
                  {(more || sense.synonyms.length + sense.similar.length < FEW_SYNONYMS) &&
                    chips("More specific", more ? sense.narrower : sense.narrower.slice(0, SPECIFIC_SHOWN), entry, sense)}
                  {more && chips("More general", sense.broader, entry, sense)}
                  {more && chips("Opposite", sense.opposites, entry, sense)}
                </div>
            ))}
          </section>
        ))}
        {entries.length > 0 && (
          <button type="button" className="lookup-more" onClick={() => setMore((m) => !m)}>
            {more ? "Fewer" : "More meanings and related words"}
          </button>
        )}
      </div>
      <div className="lookup-foot">
        <IconConstruct aria-label="Construct" />
        <button type="button" onClick={() => onAsk("synonyms")}>
          Synonyms here
        </button>
        <button type="button" onClick={() => onAsk("meaning")}>
          Meaning here
        </button>
      </div>
    </div>,
    document.body,
  );
}
