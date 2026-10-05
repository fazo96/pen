"use client";

import { STATUS_LABEL, type SaveStatus as Status } from "@/lib/useAutosave";
import { useKeys } from "@/lib/useKeys";
import EditorMenu from "./EditorMenu";
import { IconCodex, IconConstruct, IconExport, IconFocus, IconGear, IconGrammar, IconManuscript, IconOutline } from "./icons";
import Logo from "./Logo";
import SaveStatus from "./SaveStatus";
import ThemeButton from "./ThemeButton";
import WordStats from "./WordStats";

export type TopBarActions = {
  outline: () => void;
  library: () => void;
  goTo: () => void;
  focus: () => void;
  grammar: () => void;
  exportMarkdown: () => void;
  /** None when AI is off. */
  construct?: () => void;
  settings: () => void;
  find: () => void;
};

type Props = {
  /** The manuscript's, or the entry's on its own page. */
  title: string;
  isEntry: boolean;
  /** For the unlock link's way back. */
  docId: string;
  status: Status;
  /** When this device last saved, and last reached the server (useAutosave). */
  savedAt: number | null;
  reachedAt: number | null;
  words: number;
  outlineOpen: boolean;
  /** A Codex entry is open beside the manuscript. */
  panelOpen: boolean;
  constructOpen: boolean;
  grammarOn: boolean;
  /** Where Ctrl+Shift+E goes, for the Go to button's tooltip. */
  switchLabel: string;
  on: TopBarActions;
};

/** The editor's top bar: the drawer, the library, save status and the tools (folded into one menu on phones). */
export default function EditorTopBar({
  title,
  isEntry,
  docId,
  status,
  savedAt,
  reachedAt,
  words,
  outlineOpen,
  panelOpen,
  constructOpen,
  grammarOn,
  switchLabel,
  on,
}: Props) {
  const keys = useKeys();
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button type="button" className="icon-btn outline-toggle" onClick={on.outline} aria-label="Outline" aria-expanded={outlineOpen}>
          <IconOutline />
        </button>
        <button type="button" className="wordmark" onClick={on.library} title="Library" aria-label="Library">
          <Logo />
        </button>
        <span className="topbar-title" title={title}>
          {isEntry ? `Codex · ${title}` : title}
        </span>
      </div>
      <div className="topbar-right">
        {status === "locked" ? (
          // biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: the save status, a link to unlock while locked; it still announces as a status
          <a
            className="status status-locked"
            href={`/unlock?next=${encodeURIComponent(`/d/${docId}`)}`}
            role="status"
            title="Signed out. Unlock to keep saving; your text is kept on this device."
          >
            <span className="status-dot" aria-hidden />
            <span className="status-label">Locked · unlock</span>
          </a>
        ) : (
          <SaveStatus status={status} savedAt={savedAt} reachedAt={reachedAt} />
        )}
        <button
          type="button"
          className={`icon-btn ${panelOpen ? "is-on" : ""}`}
          onClick={on.goTo}
          aria-label="Go to…"
          aria-haspopup="dialog"
          title={`${keys.title("Go to…", "goTo")} · ${keys.title(switchLabel, "switch")}`}
        >
          {isEntry ? <IconManuscript /> : <IconCodex />}
        </button>
        {/* Inline on wider screens; folded into EditorMenu on phones (CSS picks one). */}
        <div className="topbar-tools">
          <span className="words label">
            <WordStats words={words} />
          </span>
          <button type="button" className="icon-btn" onClick={on.focus} aria-label="Focus mode" title={keys.title("Focus mode", "focus")}>
            <IconFocus />
          </button>
          <ThemeButton />
          <button
            type="button"
            className={`icon-btn ${grammarOn ? "is-on" : ""}`}
            onClick={on.grammar}
            aria-label="Grammar check"
            aria-pressed={grammarOn}
            title={grammarOn ? "Grammar check: on" : "Grammar check: off"}
          >
            <IconGrammar />
          </button>
          <button type="button" className="icon-btn" onClick={on.exportMarkdown} aria-label="Export markdown" title="Export .md">
            <IconExport />
          </button>
          {on.construct && (
            <button
              type="button"
              className={`icon-btn construct-toggle ${constructOpen ? "is-on" : ""}`}
              onClick={on.construct}
              aria-label="Construct"
              aria-expanded={constructOpen}
              title={keys.title("Construct", "construct")}
            >
              <IconConstruct />
            </button>
          )}
          <button type="button" className="icon-btn" onClick={on.settings} aria-label="Book settings" title="Book settings">
            <IconGear />
          </button>
        </div>
        <EditorMenu
          status={STATUS_LABEL[status]}
          words={words}
          constructOpen={constructOpen}
          onFocus={on.focus}
          grammarOn={grammarOn}
          onGrammar={on.grammar}
          onExport={on.exportMarkdown}
          onConstruct={on.construct}
          onSettings={on.settings}
          onFind={on.find}
        />
      </div>
    </header>
  );
}
