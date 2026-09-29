"use client";

import { useEffect, useState } from "react";

/**
 * Drop a markdown file anywhere on the page to import it. With `passImages`,
 * image drops are left to the element under the pointer (a book on the shelf).
 * Elements marked `data-drop-zone` (the Codex panel) take their own drops.
 */
export default function DropImport({ onFile, passImages = false }: { onFile: (file: File) => void; passImages?: boolean }) {
  const [over, setOver] = useState(false);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const isImages = (e: DragEvent) => {
      const items = [...(e.dataTransfer?.items ?? [])].filter((i) => i.kind === "file");
      return items.length > 0 && items.every((i) => i.type.startsWith("image/"));
    };
    const inZone = (e: DragEvent) => e.target instanceof Element && !!e.target.closest("[data-drop-zone]");
    const ours = (e: DragEvent) => hasFiles(e) && !(passImages && isImages(e));
    const onEnter = (e: DragEvent) => {
      if (!ours(e)) return;
      depth += 1;
      setOver(!inZone(e));
    };
    const onLeave = (e: DragEvent) => {
      if (!ours(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (ours(e)) setOver(!inZone(e));
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Keep the browser from opening the file, and the editor from inserting it.
      e.preventDefault();
      depth = 0;
      setOver(false);
      if (!ours(e) || inZone(e)) return;
      e.stopPropagation();
      const file = e.dataTransfer?.files[0];
      if (file) onFile(file);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop, true);
    };
  }, [onFile, passImages]);

  return (
    <div className={`dropzone ${over ? "is-over" : ""}`} aria-hidden>
      <div className="dropzone-inner">
        <span className="label">Import</span>
        <span className="dropzone-text">Drop the manuscript to open it</span>
      </div>
    </div>
  );
}
