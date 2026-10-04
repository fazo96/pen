"use client";

import { useRef, useState } from "react";
import { api } from "./api";
import type { LineCitation } from "./cite";
import type { VersionMeta } from "./types";
import type { Story } from "./useAutosave";

// A saved version shown over the manuscript (components/VersionPreview.tsx),
// from History or a Construct citation, and restoring it.

export type Preview = { meta: VersionMeta; content: string; cite?: LineCitation };

type Options = {
  docId: string;
  /** It opened: close what covers it. */
  onOpen: () => void;
  /** Before restoring: save the latest keystrokes, so the "before restore" copy has them. */
  beforeRestore: () => Promise<void>;
  /** The manuscript as restored. */
  onRestored: (story: Story) => void;
};

export function useVersionPreview({ docId, onOpen, beforeRestore, onRestored }: Options) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const scrollBefore = useRef(0);
  /** Settles a version citation once its preview has looked for the passage. */
  const citeShown = useRef<((found: boolean) => void) | null>(null);

  /** Show a version (scrolled to `cite`, if given). False if it can't be read. */
  const open = async (meta: VersionMeta, cite?: LineCitation) => {
    const version = await api<{ content: string }>(`/api/docs/${docId}/versions/${meta.id}`).catch(() => null);
    if (!version) return false;
    if (!preview) scrollBefore.current = window.scrollY;
    setPreview({ meta, content: version.content, cite });
    onOpen();
    window.scrollTo(0, 0);
    return true;
  };

  /** Back to the manuscript, where the writer was. */
  const close = () => {
    setPreview(null);
    requestAnimationFrame(() => window.scrollTo(0, scrollBefore.current));
  };

  /** Out of the way, and the draft drawn again (to show a passage in it). */
  const hide = async () => {
    if (!preview) return;
    setPreview(null);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };

  const restore = async () => {
    if (!preview) return;
    await beforeRestore();
    const story = await api<Story>(`/api/docs/${docId}/versions/${preview.meta.id}/restore`, { method: "POST" }).catch(
      () => null,
    );
    if (!story) return;
    onRestored(story);
    setPreview(null);
    window.scrollTo(0, 0);
  };

  /** A version Construct cited, at the passage. False when the version or the passage is gone. */
  const showCited = async (versionId: string, cite: LineCitation) => {
    const versions = await api<VersionMeta[]>(`/api/docs/${docId}/versions`).catch(() => null);
    const meta = versions?.find((v) => v.id === versionId);
    if (!meta) return false;
    citeShown.current?.(false);
    const shown = new Promise<boolean>((resolve) => (citeShown.current = resolve));
    return (await open(meta, cite)) && shown;
  };

  /** For VersionPreview's onCited: whether it found the cited passage. */
  const cited = (found: boolean) => {
    citeShown.current?.(found);
    citeShown.current = null;
  };

  /** A version renamed in History: the preview's label follows. */
  const renamed = (meta: VersionMeta) => setPreview((p) => (p && p.meta.id === meta.id ? { ...p, meta } : p));

  return { preview, open, close, hide, restore, showCited, cited, renamed };
}
