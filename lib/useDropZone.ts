"use client";

import { useState } from "react";

/**
 * Make a panel take file drops itself (the Codex, History). Spread `props` on
 * it: `data-drop-zone` tells the page-wide DropImport to step aside.
 */
export function useDropZone(onFiles: (files: File[]) => void) {
  const [dropping, setDropping] = useState(false);
  const props = {
    "data-drop-zone": true,
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setDropping(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
    },
    onDrop: (e: React.DragEvent) => {
      setDropping(false);
      onFiles([...e.dataTransfer.files]);
    },
  };
  return { dropping, props };
}
