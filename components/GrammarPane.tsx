"use client";

import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useEffect, useMemo, useState } from "react";
import { grammarFlags, grammarKey, grammarProgress, isSpelling, showFlag, type Progress } from "@/lib/grammar";
import { grammar, useGrammarEnabled, useGrammarUnreachable } from "@/lib/grammarClient";
import { dictKey, SPELLING_RULE } from "@/lib/grammarConfig";
import { flagsByHeading, repeatedWords, type PlacedFlag } from "@/lib/grammarText";
import type { Heading } from "./Outline";

type Filter = "all" | "spelling" | "grammar";
type Snapshot = { items: PlacedFlag[]; progress: Progress; doc: PMNode };

// Entries rendered at first, and per "Show more": a long book can have thousands.
const PAGE = 150;
const SNIPPET = 48;
const n = (x: number) => x.toLocaleString("en-US");

// Re-read after typing pauses; while checking runs, about once a second.
const QUIET = 800;
const PROGRESS = 1000;

/** The editor's flags and checking progress, re-read once typing pauses (the list is not cheap to redraw). */
export function useGrammarFlags(editor: Editor | null): Snapshot | null {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last: unknown[] = [];
    const read = () => {
      timer = null;
      if (editor.isDestroyed) return;
      const { state } = editor;
      const progress = grammarProgress(state);
      const key = [state.doc, grammarKey.getState(state)!.decos, progress?.checked, progress?.total];
      if (key.every((v, i) => v === last[i])) return;
      last = key;
      setSnap({ items: grammarFlags(state), progress, doc: state.doc });
    };
    const onTx = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(read, QUIET);
      } else {
        timer ??= setTimeout(read, PROGRESS);
      }
    };
    read();
    editor.on("transaction", onTx);
    return () => {
      editor.off("transaction", onTx);
      if (timer) clearTimeout(timer);
    };
  }, [editor]);
  return snap;
}

/** The words around a flag, within its paragraph. */
function snippet(doc: PMNode, { from, to }: PlacedFlag) {
  const $from = doc.resolve(from);
  const start = $from.start();
  const end = $from.end();
  let before = doc.textBetween(Math.max(start, from - SNIPPET), from, " ", " ");
  let after = doc.textBetween(to, Math.min(end, to + SNIPPET), " ", " ");
  if (from - SNIPPET > start) before = "…" + before.replace(/^\S*\s/, "");
  if (to + SNIPPET < end) after = after.replace(/\s\S*$/, "") + "…";
  return { before, word: doc.textBetween(from, to, " ", " "), after };
}

/** Every flag in the document, by chapter, with the misspellings that keep coming back. */
export default function GrammarPane({
  editor,
  headings,
  onShown,
}: {
  editor: Editor | null;
  headings: Heading[];
  onShown: () => void;
}) {
  const enabled = useGrammarEnabled();
  const unreachable = useGrammarUnreachable();
  const snap = useGrammarFlags(editor);
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);

  const items = useMemo(() => snap?.items ?? [], [snap]);
  const counts = useMemo(() => {
    const spelling = items.filter((i) => isSpelling(i.flag)).length;
    return { all: items.length, spelling, grammar: items.length - spelling };
  }, [items]);
  const shown = useMemo(
    () => (filter === "all" ? items : items.filter((i) => isSpelling(i.flag) === (filter === "spelling"))),
    [items, filter],
  );
  const sections = useMemo(() => flagsByHeading(shown, headings), [shown, headings]);
  // How many entries come before each section, to share out `limit`.
  const budget = useMemo(() => {
    let before = 0;
    return sections.map((s) => ((before += s.items.length), before - s.items.length));
  }, [sections]);
  const words = useMemo(
    () => (filter === "grammar" ? [] : repeatedWords(items, SPELLING_RULE, dictKey)),
    [items, filter],
  );

  if (!enabled) {
    return (
      <div className="grammar-pane">
        <p className="outline-empty">The grammar check is off on this device.</p>
        <button type="button" className="history-new" onClick={() => grammar.setEnabled(true)}>
          Turn it on
        </button>
      </div>
    );
  }
  if (!editor || !snap) return <div className="grammar-pane" aria-busy />;

  const show = (item: PlacedFlag) => {
    onShown();
    // After the drawer has closed on phones, so the popover lands in view.
    requestAnimationFrame(() => showFlag(editor.view, item));
  };
  const progress = snap.progress;

  return (
    <div className="grammar-pane">
      <p className="grammar-status label" role="status">
        {unreachable && (!progress || progress.checked < progress.total)
          ? "Checking paused: pen’s server didn’t answer. It tries again as you type."
          : !progress
            ? "Checking…"
            : progress.checked < progress.total
              ? `Checking… ${n(progress.checked)} of ${n(progress.total)} paragraphs`
              : items.length
                ? `${n(items.length)} ${items.length === 1 ? "flag" : "flags"}`
                : "Nothing flagged"}
      </p>

      {items.length > 0 && (
        <div className="grammar-filters" role="radiogroup" aria-label="Show">
          {(["all", "spelling", "grammar"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              onClick={() => {
                setFilter(f);
                setLimit(PAGE);
              }}
            >
              {f} <span>{n(counts[f])}</span>
            </button>
          ))}
        </div>
      )}

      {words.length > 0 && (
        <section className="grammar-section">
          <h3 className="grammar-section-head label">Unknown words</h3>
          <ul className="grammar-unknown">
            {words.map((w) => (
              <li key={w.word}>
                <button type="button" className="grammar-unknown-word" onClick={() => show(w.first)}>
                  {w.word} <span>×{n(w.count)}</span>
                </button>
                <button
                  type="button"
                  className="grammar-unknown-add"
                  onClick={() => void grammar.update({ addWord: w.word })}
                  title={`Add “${w.word}” to the dictionary`}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sections.map((s, i) => {
        const key = s.heading?.pos ?? -1;
        const list = s.items.slice(0, Math.max(0, limit - budget[i]));
        if (!list.length) return null;
        return (
          <section key={`${key}:${i}`} className="grammar-section">
            <h3 className="grammar-section-head label">
              {s.heading ? s.heading.text || "Untitled" : "Opening"} <span>{n(s.items.length)}</span>
            </h3>
            <ol className="grammar-list">
              {list.map((item) => {
                const { before, word, after } = snippet(snap.doc, item);
                return (
                  <li key={`${item.from}:${item.flag.rule}`}>
                    <button type="button" className="grammar-item" onClick={() => show(item)}>
                      <span className="grammar-snippet">
                        {before}
                        <mark className={isSpelling(item.flag) ? "is-spelling" : "is-grammar"}>{word}</mark>
                        {after}
                      </span>
                      <span className="grammar-why">{item.flag.message.replace(/`([^`]*)`/g, "“$1”")}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
      {shown.length > limit && (
        <button type="button" className="history-new grammar-more" onClick={() => setLimit(limit + PAGE)}>
          Show more · {n(shown.length - limit)} left
        </button>
      )}
    </div>
  );
}

/** The flag count on the drawer's tab. */
export function GrammarCount({ editor }: { editor: Editor | null }) {
  const enabled = useGrammarEnabled();
  const snap = useGrammarFlags(editor);
  if (!enabled || !snap?.items.length) return null;
  return <span className="drawer-tab-count">{n(snap.items.length)}</span>;
}
