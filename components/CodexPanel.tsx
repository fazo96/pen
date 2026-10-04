"use client";

import { type Editor, EditorContent } from "@tiptap/react";
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { textWithoutComments } from "@/lib/comments";
import { straightenQuotes } from "@/lib/quotes";
import { STATUS_LABEL, type Story, useAutosave } from "@/lib/useAutosave";
import { usePenEditor } from "@/lib/usePenEditor";
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
  const touchRef = useRef<() => void>(() => {});
  const editor = usePenEditor("entry", entry.content, () => {
    touchRef.current();
    onChange();
  });

  const getContent = useCallback(() => (editor ? editor.getMarkdown() : null), [editor]);
  const setContent = useCallback(
    (md: string) => editor?.commands.setContent(md, { contentType: "markdown", emitUpdate: false }),
    [editor],
  );
  const autosave = useAutosave({
    initial: entry,
    url: `/api/docs/${projectId}/codex/${entry.id}`,
    backupKey: `pen:backup:${projectId}/codex/${entry.id}`,
    getContent,
    setContent,
    ready: !!editor,
  });
  const { status, conflict, leave, pull, resolveConflict } = autosave;
  touchRef.current = autosave.touch;

  useImperativeHandle(handle, () => ({ leave, pull }), [leave, pull]);

  // Curly quotes from imports or older text are straightened on open (saved by autosave).
  useEffect(() => {
    const tr = editor ? straightenQuotes(editor.state) : null;
    if (tr) editor!.view.dispatch(tr);
  }, [editor]);

  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // The title is the first top-level heading, as on the entry's own page.
  useEffect(() => {
    if (!editor) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const scan = () => {
      let found = "";
      editor.state.doc.forEach((node) => {
        if (!found && node.type.name === "heading" && node.attrs.level === 1) {
          found = textWithoutComments(node).trim();
        }
      });
      setTitle(found);
    };
    const onTx = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      if (t) clearTimeout(t);
      t = setTimeout(scan, 200);
    };
    scan();
    editor.on("transaction", onTx);
    return () => {
      editor.off("transaction", onTx);
      if (t) clearTimeout(t);
    };
  }, [editor]);

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
          <span className={`status status-${status}`} role="status" aria-live="polite" title={STATUS_LABEL[status]}>
            <span className="status-dot" aria-hidden />
          </span>
          <button type="button" className="icon-btn" onClick={onExpand} aria-label="Open full page" title="Open full page">
            <IconExpand />
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close entry" title="Close">
            <IconClose />
          </button>
        </div>
      </div>

      {conflict && (
        <div className="conflict codex-panel-conflict" role="alert">
          <p>
            <span className="label">Conflict</span>
            This entry was changed elsewhere.
          </p>
          <div className="conflict-actions">
            <button type="button" onClick={() => resolveConflict("theirs")}>
              Load theirs
            </button>
            <button type="button" className="primary" onClick={() => resolveConflict("mine")}>
              Keep mine
            </button>
          </div>
        </div>
      )}

      {children}
      <div className="codex-panel-body">
        {editor ? <EditorContent editor={editor} /> : <div className="prose loading" aria-busy />}
      </div>
    </aside>
  );
}
