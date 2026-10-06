"use client";

import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { useEffect, useMemo, useState } from "react";
import { listComments, type PlacedComment } from "@/lib/comments";
import { flagsByHeading } from "@/lib/grammarText";
import type { Heading } from "./Outline";

const n = (x: number) => x.toLocaleString("en-US");

// Re-read after typing pauses.
const QUIET = 800;

/** The editor's comments, re-read once typing pauses. */
function useComments(editor: Editor | null): PlacedComment[] | null {
  const [list, setList] = useState<PlacedComment[] | null>(null);
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      timer = null;
      if (!editor.isDestroyed) setList(listComments(editor.state.doc));
    };
    const onTx = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(read, QUIET);
    };
    read();
    editor.on("transaction", onTx);
    return () => {
      editor.off("transaction", onTx);
      if (timer) clearTimeout(timer);
    };
  }, [editor]);
  return list;
}

/** Every comment in the document, by chapter. */
export default function CommentsPane({
  editor,
  headings,
  onShown,
}: {
  editor: Editor | null;
  headings: Heading[];
  onShown: () => void;
}) {
  const items = useComments(editor);
  const sections = useMemo(() => flagsByHeading(items ?? [], headings), [items, headings]);

  if (!editor || !items) return <div className="grammar-pane" aria-busy />;
  if (!items.length) return <p className="outline-empty">No comments.</p>;

  const show = (c: PlacedComment) => {
    onShown();
    // After the drawer has closed on phones, so the comment lands in view.
    requestAnimationFrame(() => {
      const { view } = editor;
      const { doc } = view.state;
      if (c.to > doc.content.size) return;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, c.from, c.to)));
      const top = view.coordsAtPos(c.from).top;
      window.scrollBy({ top: top - window.innerHeight * 0.4, behavior: "smooth" });
    });
  };

  return (
    <div className="grammar-pane">
      {sections.map((s, i) => (
        <section key={`${s.heading?.pos ?? -1}:${i}`} className="grammar-section">
          <h3 className="grammar-section-head label">
            {s.heading ? s.heading.text || "Untitled" : "Opening"} <span>{n(s.items.length)}</span>
          </h3>
          <ol className="grammar-list">
            {s.items.map((c) => (
              <li key={c.from}>
                <button type="button" className="grammar-item" onClick={() => show(c)}>
                  {c.inline ? (
                    <span className="grammar-snippet">
                      {c.before}
                      <span className="comments-text">{c.text}</span>
                      {c.after}
                    </span>
                  ) : (
                    <span className="comments-text">{c.text || "Empty comment"}</span>
                  )}
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** The comment count on the drawer's tab. */
export function CommentsCount({ editor }: { editor: Editor | null }) {
  const items = useComments(editor);
  if (!items?.length) return null;
  return <span className="drawer-tab-count">{n(items.length)}</span>;
}
