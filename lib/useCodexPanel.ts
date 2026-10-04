"use client";

import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CodexPanelHandle } from "@/components/CodexPanel";
import { matches, TOUCH, WIDE } from "./media";
import { useMedia } from "./useMedia";

// The Codex entry open beside the manuscript (components/CodexPanel.tsx), on
// screens wide enough for both: which one, its editor and title, and whether
// its editor or the manuscript's was used last (the toolbar, find and
// Construct follow that one). Kept in the address as ?entry=.

/** The cursor into `ed`; not on touch screens, where it would bring up the keyboard. */
export function focusText(ed: Editor | null) {
  if (!ed || ed.isDestroyed || matches(TOUCH)) return;
  requestAnimationFrame(() => !ed.isDestroyed && ed.view.focus());
}

type Options = {
  projectId: string;
  /** Off on a Codex entry's own page, which has no panel. */
  enabled: boolean;
  /** From ?entry=. */
  initialEntry?: string;
  /** The manuscript's editor. */
  editor: Editor | null;
};

export function useCodexPanel({ projectId, enabled, initialEntry, editor }: Options) {
  const [entry, setEntry] = useState<string | null>(enabled ? (initialEntry ?? null) : null);
  const [panelEditor, setPanelEditor] = useState<Editor | null>(null);
  // Tagged with its entry, so one opening never shows the last one's title.
  const [titled, setTitled] = useState<{ id: string; title: string } | null>(null);
  const title = titled?.id === entry ? titled.title || undefined : undefined;
  const onTitle = useCallback((id: string, title: string) => setTitled({ id, title }), []);
  const [focused, setFocused] = useState(false);
  const handle = useRef<CodexPanelHandle>(null);

  /** Save what's typed in it. */
  const leave = async () => {
    await handle.current?.leave();
  };
  /** Show `eid` (saving the one shown). False if it's already there. */
  const open = async (eid: string) => {
    if (eid === entry) return false;
    await leave();
    setEntry(eid);
    return true;
  };
  const close = async () => {
    await leave();
    setEntry(null);
    setFocused(false);
  };
  /** Gone without saving: its file is gone. */
  const drop = () => {
    setEntry(null);
    setFocused(false);
  };

  // Keep the open entry in the address, so a reload brings it back.
  useEffect(() => {
    if (!enabled) return;
    const url = entry ? `/d/${projectId}?entry=${encodeURIComponent(entry)}` : `/d/${projectId}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, "", url);
  }, [enabled, projectId, entry]);

  // No room: close it.
  const wide = useMedia(WIDE);
  useEffect(() => {
    if (wide === false && entry) void close();
    // Only when the width changes, not when an entry opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide]);

  // Which editor was used last.
  useEffect(() => {
    if (!editor) return;
    const onMain = () => setFocused(false);
    editor.on("focus", onMain);
    return () => {
      editor.off("focus", onMain);
    };
  }, [editor]);
  useEffect(() => {
    if (!panelEditor) return;
    const onPanel = () => setFocused(true);
    panelEditor.on("focus", onPanel);
    return () => {
      panelEditor.off("focus", onPanel);
    };
  }, [panelEditor]);

  // Its editor appears once the entry has loaded: the cursor goes in then.
  const focusWanted = useRef(false);
  useEffect(() => {
    if (!panelEditor || !focusWanted.current) return;
    focusWanted.current = false;
    focusText(panelEditor);
  }, [panelEditor]);
  /** The cursor into its text, now or once it has loaded. */
  const focus = () => {
    if (panelEditor) focusText(panelEditor);
    else focusWanted.current = true;
  };

  return {
    entry,
    editor: panelEditor,
    title,
    /** Its editor was used last, not the manuscript's. */
    inPanel: focused && !!panelEditor && !!entry,
    open,
    close,
    drop,
    /** Renamed elsewhere (Construct): follow it. */
    renamed: setEntry,
    leave,
    pull: async () => {
      await handle.current?.pull();
    },
    focus,
    /** For <CodexPanel>. */
    props: { handle, onEditor: setPanelEditor, onTitle },
  };
}
