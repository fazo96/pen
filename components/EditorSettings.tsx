"use client";

import { setSteady, useSteady } from "@/lib/useSteady";
import { IconPencil } from "./icons";

/** How the editor behaves on this device. */
export default function EditorSettings() {
  const steady = useSteady();
  return (
    <section className="lock" aria-labelledby="editor-title">
      <div className="lock-head">
        <IconPencil />
        <h2 id="editor-title" className="label">
          Editor
        </h2>
        <span className="lock-state">Fade {steady ? "off" : "on"} here</span>
      </div>
      <p className="lock-text">
        While you type, the top bar, the outline and the Codex panel dim so the page stands out; moving the pointer or
        scrolling brings them back. Turn it off to keep them steady.
      </p>
      <div className="lock-actions">
        <button type="button" className="btn" onClick={() => setSteady(!steady)}>
          {steady ? "Turn the fade on here" : "Turn the fade off here"}
        </button>
      </div>
    </section>
  );
}
