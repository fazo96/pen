"use client";

import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { findPassage, type LineCitation } from "@/lib/cite";
import { CommentExtensions } from "@/lib/comments";
import type { DocDiff } from "@/lib/diff";
import { PenMarkdown } from "@/lib/markdownEscape";
import { PenOrderedList } from "@/lib/orderedList";
import { CitedPassage, showPassage } from "@/lib/passage";
import { straightenQuotes } from "@/lib/quotes";
import type { VersionMeta } from "@/lib/versions";
import { IconDown, IconUp } from "./icons";

type Props = {
  meta: VersionMeta;
  content: string;
  /** The live draft, to compare against. */
  draft: PMNode | null;
  /** A passage Construct cited, to show once the version is on screen. */
  cite?: LineCitation;
  /** Whether the cited passage was found. */
  onCited?: (found: boolean) => void;
  onRestore: () => Promise<void>;
  onClose: () => void;
};

const CHANGES_KEY = "pen:changes";
const changesKey = new PluginKey<DecorationSet>("versionChanges");

/** Holds the "Changes" decorations; set with a `changesKey` meta. */
const Changes = Extension.create({
  name: "versionChanges",
  addProseMirrorPlugins: () => [
    new Plugin<DecorationSet>({
      key: changesKey,
      state: {
        init: () => DecorationSet.empty,
        apply: (tr, set) => tr.getMeta(changesKey) ?? set,
      },
      props: { decorations: (state) => changesKey.getState(state) },
    }),
  ],
});

/** A version shown read-only in the manuscript's own typography. */
export default function VersionPreview({ meta, content, draft, cite, onCited, onRestore, onClose }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const [diff, setDiff] = useState<DocDiff | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const viewer = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, orderedList: false }),
      PenOrderedList,
      PenMarkdown,
      ...CommentExtensions,
      Changes,
      CitedPassage,
    ],
    content,
    contentType: "markdown",
    editorProps: { attributes: { class: "prose is-preview", "aria-label": "Version preview" } },
  });

  useEffect(() => {
    try {
      if (localStorage.getItem(CHANGES_KEY)) setShowChanges(true);
    } catch {}
  }, []);

  const toggleChanges = () => {
    const next = !showChanges;
    setShowChanges(next);
    try {
      if (next) localStorage.setItem(CHANGES_KEY, "1");
      else localStorage.removeItem(CHANGES_KEY);
    } catch {}
  };

  // Shown with straight quotes, like the draft, so they don't all read as changes.
  // Display only: Restore still brings back the stored text.
  useEffect(() => {
    const tr = viewer ? straightenQuotes(viewer.state) : null;
    if (tr) viewer!.view.dispatch(tr);
  }, [viewer]);

  // Show a cited passage (after the quotes above, so the text matches).
  useEffect(() => {
    if (!viewer || !cite) return;
    const range = findPassage(viewer.state.doc, content.split("\n"), cite);
    if (range) showPassage(viewer.view, range);
    onCited?.(!!range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, cite]);

  useEffect(() => {
    if (!viewer) return;
    const show =(set: DecorationSet) => viewer.view.dispatch(viewer.state.tr.setMeta(changesKey, set));
    if (!showChanges || !draft) {
      show(DecorationSet.empty);
      setDiff(null);
      return;
    }
    let live = true;
    // The diff code only loads once someone asks for changes.
    import("@/lib/diff").then(({ diffDocs }) => {
      if (!live) return;
      const d = diffDocs(viewer.state.doc, draft);
      show(d.decorations);
      setDiff(d);
    });
    return () => {
      live = false;
    };
  }, [viewer, showChanges, draft]);

  /** Scrolls to the next change below (or above) the reading line. */
  const jump = (dir: 1 | -1) => {
    if (!viewer || !diff?.stops.length) return;
    // A third of the way down, or just under the sticky bar if that reaches lower.
    const line = Math.max(window.innerHeight * 0.3, (bar.current?.getBoundingClientRect().bottom ?? 0) + 32);
    const tops = diff.stops.map((pos) => viewer.view.coordsAtPos(Math.min(pos + 1, viewer.state.doc.content.size)).top);
    const target = dir > 0 ? tops.find((t) => t > line + 4) : tops.findLast((t) => t < line - 4);
    if (target !== undefined) window.scrollBy({ top: target - line, behavior: "smooth" });
  };

  const when = new Date(meta.created).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <div ref={bar} className="preview-bar" role="region" aria-label="Viewing a version">
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
              <button
                type="button"
                className={`btn${showChanges ? " is-on" : ""}`}
                aria-pressed={showChanges}
                title="Mark what changed between this version and the current draft"
                onClick={toggleChanges}
              >
                Changes
              </button>
              <button type="button" className="btn" onClick={() => setConfirming(true)}>
                Restore…
              </button>
            </>
          )}
        </div>
        {showChanges && (
          <div className="preview-changes" aria-live="polite">
            {!diff ? (
              <span className="label">Comparing…</span>
            ) : diff.stops.length === 0 ? (
              <span className="label">Same as the current draft</span>
            ) : (
              <>
                <span className="label">Since then</span>
                <span className="diff-count">
                  <span className="diff-count-ins">+{diff.added}</span>{" "}
                  <span className="diff-count-del">−{diff.removed}</span>{" "}
                  <span className="label">words</span>
                </span>
                <span className="preview-nav">
                  <button type="button" className="icon-btn" aria-label="Previous change" title="Previous change" onClick={() => jump(-1)}>
                    <IconUp />
                  </button>
                  <button type="button" className="icon-btn" aria-label="Next change" title="Next change" onClick={() => jump(1)}>
                    <IconDown />
                  </button>
                </span>
              </>
            )}
          </div>
        )}
      </div>
      {viewer ? <EditorContent editor={viewer} /> : <div className="prose loading" aria-busy />}
    </>
  );
}
