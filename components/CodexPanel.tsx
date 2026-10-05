"use client";

import { type Editor, EditorContent } from "@tiptap/react";
import { useEffect, useImperativeHandle, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { textWithoutComments } from "@/lib/comments";
import type { Story } from "@/lib/useAutosave";
import { focusFromMargin } from "@/lib/marginFocus";
import { useDocScan, useEditorDoc } from "@/lib/useEditorDoc";
import ConflictBanner from "./ConflictBanner";
import SaveStatus from "./SaveStatus";
import { IconClose, IconExpand } from "./icons";

export type CodexPanelHandle = {
  /** Save anything pending. */
  leave: () => Promise<void>;
  /** Reload the entry if it changed on the server. */
  pull: () => Promise<void>;
};

type Props = {
  projectId: string;
  entryId: string;
  handle: React.Ref<CodexPanelHandle>;
  onClose: () => void;
  /** Open the entry on its own page. */
  onExpand: () => void;
  /** The entry is gone (deleted elsewhere). */
  onMissing: () => void;
  onEditor: (editor: Editor | null) => void;
  /** The entry's live title ("" without an H1), once its editor has it. */
  onTitle: (entryId: string, title: string) => void;
  onChange: () => void;
  /** Over the entry, under the head: the find bar. */
  children?: React.ReactNode;
};

/** A codex entry beside the manuscript, on screens wide enough for both. */
export default function CodexPanel(props: Props) {
  const { projectId, entryId, onClose, onMissing } = props;
  const [entry, setEntry] = useState<Story | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const story = await api<Story>(`/api/docs/${projectId}/codex/${entryId}`);
        if (live) setEntry(story);
      } catch (err) {
        if (!live) return;
        if (err instanceof ApiError && err.status === 404) onMissing();
        else setError(true);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, entryId]);

  if (!entry) {
    return (
      <aside className="codex-panel" aria-label="Codex entry" aria-busy={!error}>
        <div className="codex-panel-head">
          <span className="codex-panel-title label">Codex</span>
          <div className="construct-head-actions">
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close entry" title="Close">
              <IconClose />
            </button>
          </div>
        </div>
        {error && (
          <p className="outline-empty" role="alert">
            Couldn’t load the entry.
          </p>
        )}
      </aside>
    );
  }
  return <EntryEditor {...props} entry={entry} />;
}

function EntryEditor({
  projectId,
  entry,
  handle,
  onClose,
  onExpand,
  onEditor,
  onTitle,
  onChange,
  children,
}: Props & { entry: Story }) {
  const [title, setTitle] = useState<string | null>(null);
  const { editor, status, savedAt, reachedAt, conflict, leave, pull, resolveConflict } = useEditorDoc({
    kind: "entry",
    initial: entry,
    url: `/api/docs/${projectId}/codex/${entry.id}`,
    backupKey: `pen:backup:${projectId}/codex/${entry.id}`,
    onEdit: onChange,
  });

  useImperativeHandle(handle, () => ({ leave, pull }), [leave, pull]);

  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // The title is the first top-level heading, as on the entry's own page.
  useDocScan(editor, (doc) => {
    let found = "";
    doc.forEach((node) => {
      if (!found && node.type.name === "heading" && node.attrs.level === 1) found = textWithoutComments(node).trim();
    });
    setTitle(found);
  });

  useEffect(() => {
    if (title !== null) onTitle(entry.id, title);
  }, [entry.id, title, onTitle]);

  return (
    <aside className="codex-panel" aria-label="Codex entry">
      <div className="codex-panel-head">
        <span className="codex-panel-title label" title={title || "Untitled"}>
          Codex · {title || "Untitled"}
        </span>
        <div className="construct-head-actions">
          <SaveStatus status={status} savedAt={savedAt} reachedAt={reachedAt} dotOnly />
          <button type="button" className="icon-btn" onClick={onExpand} aria-label="Open full page" title="Open full page">
            <IconExpand />
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close entry" title="Close">
            <IconClose />
          </button>
        </div>
      </div>

      {conflict && (
        <ConflictBanner what="This entry was changed elsewhere." className="codex-panel-conflict" onResolve={resolveConflict} />
      )}

      {children}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a click beside the text focuses the editor, which keyboards reach directly */}
      <div className="codex-panel-body" onMouseDown={(e) => focusFromMargin(editor, e)}>
        {editor ? <EditorContent editor={editor} /> : <div className="prose loading" aria-busy />}
      </div>
    </aside>
  );
}
