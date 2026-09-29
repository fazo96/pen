"use client";

import { useEffect, useState } from "react";

/** Drop a markdown file anywhere on the page to import it. */
export default function DropImport({ onFile }: { onFile: (file: File) => void }) {
  const [over, setOver] = useState(false);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setOver(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Keep the browser from opening the file, and the editor from inserting it.
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      setOver(false);
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
  }, [onFile]);

  return (
    <div className={`dropzone ${over ? "is-over" : ""}`} aria-hidden>
      <div className="dropzone-inner">
        <span className="label">Import</span>
        <span className="dropzone-text">Drop the manuscript to open it</span>
      </div>
    </div>
  );
}
