"use client";

import { setSteady, useSteady } from "@/lib/useSteady";
import SettingsHead from "./SettingsHead";
import { IconPencil } from "./icons";

/** How the editor behaves on this device. */
export default function EditorSettings() {
  const steady = useSteady();
  return (
    <section className="settings-section" aria-labelledby="editor-title">
      <SettingsHead icon={<IconPencil />} title="Editor" id="editor-title">
        <span className="settings-state">Fade {steady ? "off" : "on"} here</span>

      </SettingsHead>
      <p className="settings-text">
        While you type, the top bar, the outline and the Codex panel dim so the page stands out; moving the pointer or
        scrolling brings them back. Turn it off to keep them steady.
      </p>
      <div className="settings-actions">
        <button type="button" className="btn" onClick={() => setSteady(!steady)}>
          {steady ? "Turn the fade on here" : "Turn the fade off here"}
        </button>
      </div>
    </section>
  );
}
