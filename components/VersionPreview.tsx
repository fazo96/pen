"use client";

import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useState } from "react";
import { CommentExtensions } from "@/lib/comments";
import type { VersionMeta } from "@/lib/versions";

type Props = {
  meta: VersionMeta;
  content: string;
  onRestore: () => Promise<void>;
  onClose: () => void;
};

/** A version shown read-only in the manuscript's own typography. */
export default function VersionPreview({ meta, content, onRestore, onClose }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const viewer = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), Markdown, ...CommentExtensions],
    content,
    contentType: "markdown",
    editorProps: { attributes: { class: "prose is-preview", "aria-label": "Version preview" } },
  });

  const when = new Date(meta.created).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <div className="preview-bar" role="region" aria-label="Viewing a version">
        <div className="preview-what">
          <span className="label">Viewing</span>
          <span className="preview-label">{meta.label || "Saved version"}</span>
          <span className="label">{when}</span>
        </div>
        <div className="preview-actions">
          {confirming ? (
            <>
              <span className="preview-confirm">Replace the current text? It’s kept as a version.</span>
              <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await onRestore();
                  setBusy(false);
                }}
              >
                {busy ? "Restoring…" : "Restore"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-quiet" onClick={onClose}>
                Back
              </button>
              <button type="button" className="btn" onClick={() => setConfirming(true)}>
                Restore…
              </button>
            </>
          )}
        </div>
      </div>
      {viewer ? <EditorContent editor={viewer} /> : <div className="prose loading" aria-busy />}
    </>
  );
}
