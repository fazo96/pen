"use client";

import { IconUnfocus } from "./icons";

type Props = { pinned: boolean; onToggleToolbar: () => void; onExit: () => void };

/** The only chrome left in focus mode: a toolbar toggle and a way out. */
export default function FocusControls({ pinned, onToggleToolbar, onExit }: Props) {
  return (
    <div className="focus-controls">
      <button
        type="button"
        className="focus-btn"
        aria-label={pinned ? "Hide toolbar" : "Show toolbar"}
        title={pinned ? "Hide toolbar" : "Show toolbar"}
        aria-pressed={pinned}
        // Keep the caret (and the phone keyboard) in the manuscript.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggleToolbar}
      >
        <span className="focus-glyph">Aa</span>
      </button>
      <button
        type="button"
        className="focus-btn"
        aria-label="Exit focus mode"
        title="Exit focus mode (Esc)"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onExit}
      >
        <IconUnfocus />
      </button>
    </div>
  );
}
