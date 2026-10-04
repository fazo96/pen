"use client";

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import { hasCurlyQuotes, straightenQuotes } from "./quotes";
import { type Story, useAutosave } from "./useAutosave";
import { usePenEditor } from "./usePenEditor";

// One document in an editor, autosaved: the manuscript or a Codex entry, on its
// own page or in the side panel (components/Pen.tsx, CodexPanel.tsx).

type Options = {
  kind: "manuscript" | "entry";
  initial: Story;
  /** Where it's saved, and its localStorage backup. */
  url: string;
  backupKey: string;
  /** After every edit. */
  onEdit?: () => void;
  /**
   * Curly quotes are straightened once it opens (autosave then saves that).
   * This runs first; false leaves them for next time (the manuscript saves a
   * version before, and doesn't change without one).
   */
  beforeStraightening?: () => Promise<boolean>;
};

export function useEditorDoc({ kind, initial, url, backupKey, onEdit, beforeStraightening }: Options) {
  // Called from the editor's updates, so the latest of each is kept in a ref.
  const touch = useRef<() => void>(() => {});
  const edited = useRef(onEdit);
  useEffect(() => {
    edited.current = onEdit;
  });
  const editor = usePenEditor(kind, initial.content, () => {
    touch.current();
    edited.current?.();
  });
  const getContent = useCallback(() => (editor ? editor.getMarkdown() : null), [editor]);
  const setContent = useCallback(
    (md: string) => editor?.commands.setContent(md, { contentType: "markdown", emitUpdate: false }),
    [editor],
  );
  const autosave = useAutosave({ initial, url, backupKey, getContent, setContent, ready: !!editor });
  useEffect(() => {
    touch.current = autosave.touch;
  }, [autosave.touch]);

  const before = useEffectEvent(() => (beforeStraightening ? beforeStraightening() : Promise.resolve(true)));
  useEffect(() => {
    if (!editor || !hasCurlyQuotes(editor.state.doc)) return;
    void (async () => {
      if (!(await before())) return;
      const tr = straightenQuotes(editor.state);
      if (tr) editor.view.dispatch(tr);
    })();
  }, [editor]);

  return { editor, ...autosave };
}

/** Calls `scan` with the document now, and again 200 ms after edits pause. */
export function useDocScan(editor: Editor | null, scan: (doc: PMNode) => void) {
  const run = useEffectEvent(() => editor && scan(editor.state.doc));
  useEffect(() => {
    if (!editor) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const onTx = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      if (t) clearTimeout(t);
      t = setTimeout(run, 200);
    };
    run();
    editor.on("transaction", onTx);
    return () => {
      editor.off("transaction", onTx);
      if (t) clearTimeout(t);
    };
  }, [editor]);
}
