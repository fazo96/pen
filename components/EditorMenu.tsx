"use client";

import { useRef, useState } from "react";
import { useDismiss } from "@/lib/useDismiss";
import { useTheme } from "@/lib/useTheme";
import WordStats from "./WordStats";
import { IconConstruct, IconExport, IconFocus, IconGear, IconGrammar, IconMore, IconSearch, IconTheme } from "./icons";

type Props = {
  status: string;
  words: number;
  constructOpen: boolean;
  grammarOn: boolean;
  onFocus: () => void;
  onGrammar: () => void;
  onExport: () => void;
  /** None when AI is off. */
  onConstruct?: () => void;
  onSettings: () => void;
  onFind: () => void;
};

/** On phones, the editor's top-bar tools folded into one "⋯" menu. */
export default function EditorMenu(props: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useDismiss(open, root, () => setOpen(false));

  return (
    <div className="editor-menu" ref={root}>
      <button
        type="button"
        className={`icon-btn ${props.constructOpen ? "is-on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <IconMore />
      </button>
      {open && <Items {...props} close={() => setOpen(false)} />}
    </div>
  );
}

// Mounted only while open, so the theme label is read fresh each time.
function Items({ status, words, constructOpen, grammarOn, onFocus, onGrammar, onExport, onConstruct, onSettings, onFind, close }: Props & { close: () => void }) {
  const theme = useTheme();
  const pick = (fn: () => void) => () => {
    close();
    fn();
  };

  return (
    <div className="popover-menu editor-menu-list" role="menu">
      <p className="editor-menu-head label">
        <WordStats words={words} lead={status} />
      </p>
      <button type="button" role="menuitem" onClick={pick(onFind)}>
        <IconSearch /> Find
      </button>
      <button type="button" role="menuitem" onClick={pick(onFocus)}>
        <IconFocus /> Focus mode
      </button>
      <button type="button" role="menuitem" onClick={theme.cycle}>
        <IconTheme /> Theme <span className="editor-menu-value">{theme.label}</span>
      </button>
      <button type="button" role="menuitemcheckbox" aria-checked={grammarOn} onClick={onGrammar}>
        <IconGrammar /> Grammar <span className="editor-menu-value">{grammarOn ? "On" : "Off"}</span>
      </button>
      <button type="button" role="menuitem" onClick={pick(onExport)}>
        <IconExport /> Export .md
      </button>
      {onConstruct && (
        <button type="button" role="menuitem" className={constructOpen ? "is-on" : ""} onClick={pick(onConstruct)}>
          <IconConstruct /> Construct {constructOpen && <span className="editor-menu-value">Open</span>}
        </button>
      )}
      <button type="button" role="menuitem" onClick={pick(onSettings)}>
        <IconGear /> Book settings
      </button>
    </div>
  );
}
