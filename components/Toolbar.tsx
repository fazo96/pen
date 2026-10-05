"use client";

import { type Editor, useEditorState } from "@tiptap/react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ShortcutId } from "@/lib/shortcuts";
import { useDismiss } from "@/lib/useDismiss";
import { useKeys } from "@/lib/useKeys";
import { askDraft, constructPrompt, pickedWords, requestLookUp } from "@/lib/wordTools";
import { IconBook, IconBullets, IconConstruct, IconDown, IconNumbers, IconQuote, IconRedo, IconUndo } from "./icons";
import type { Ask } from "./WordTools";

type ButtonProps = {
  label: string;
  /** Its shortcut, shown in the tooltip. */
  keys?: ShortcutId;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
  className?: string;
};

function Button({ label, keys, active, disabled, onPress, children, className }: ButtonProps) {
  const k = useKeys();
  return (
    <button
      type="button"
      className={`tool ${className ?? ""}`}
      aria-label={label}
      title={keys ? k.title(label, keys) : label}
      aria-pressed={active}
      disabled={disabled}
      // Keep focus (and the mobile keyboard) in the editor.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

const HEADING_KEYS: ShortcutId[] = ["text", "h1", "h2", "h3", "h4"];

/** What the paragraph is: normal text or a heading, picked from a menu over the toolbar. */
function HeadingMenu({ editor, level, names }: { editor: Editor; level: number; names: readonly string[] }) {
  const k = useKeys();
  // Where the menu opens: in the toolbar, outside its scrolling row, which would clip it.
  const [at, setAt] = useState<{ bar: Element; left: number } | null>(null);
  const open = !!at;
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => setAt(null);
  useDismiss(open, (t) => !!button.current?.contains(t) || !!menu.current?.contains(t), close, { escapeFirst: true });
  const kinds = ["Text", ...names];

  const toggle = () => {
    const b = button.current;
    const bar = b?.closest(".toolbar");
    if (open || !b || !bar) return close();
    const barBox = bar.getBoundingClientRect();
    // Keep the menu (about 220px wide) inside the toolbar when the button sits near its right end.
    setAt({ bar, left: Math.max(0, Math.min(b.getBoundingClientRect().left - barBox.left, barBox.width - 220)) });
  };
  const pick = (l: number) => {
    const chain = editor.chain().focus();
    (l ? chain.setHeading({ level: l as 1 | 2 | 3 | 4 }) : chain.setParagraph()).run();
    close();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="tool tool-text heading-tool"
        aria-label={`Paragraph style: ${kinds[level]}`}
        title="Paragraph style"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
      >
        {kinds[level]}
        <IconDown />
      </button>
      {at &&
        createPortal(
          <div ref={menu} className="popover-menu heading-menu" role="menu" style={{ left: at.left }}>
            {kinds.map((name, l) => (
              <button
                key={name}
                type="button"
                role="menuitemradio"
                aria-checked={l === level}
                className={`heading-menu-${l} ${l === level ? "is-on" : ""}`}
                title={k.title(name, HEADING_KEYS[l])}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(l)}
              >
                {name}
                <span className="heading-menu-keys">{k.key(HEADING_KEYS[l])}</span>
              </button>
            ))}
          </div>,
          at.bar,
        )}
    </>
  );
}

type Props = {
  editor: Editor;
  /** Names for heading levels 1–4, shown in the paragraph style menu. */
  headingNames: readonly string[];
  /** Construct's questions about the selection; none when AI is off. */
  onAsk?: Ask;
};

export default function Toolbar({ editor, headingNames, onAsk }: Props) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      level: e.isActive("heading") ? (e.getAttributes("heading").level as number) : 0,
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      quote: e.isActive("blockquote"),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
      comment: e.isActive("comment") || e.isActive("commentBlock"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      picked: pickedWords(e.state),
    }),
    equalityFn: (a, b) =>
      !!a &&
      !!b &&
      Object.keys(a).every((k) =>
        k === "picked"
          ? a.picked?.from === b.picked?.from && a.picked?.to === b.picked?.to
          : a[k as keyof typeof a] === b[k as keyof typeof b],
      ),
  });
  const picked = s.picked;

  const run = () => editor.chain().focus();

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <div className="toolbar-scroll">
        {/* Phones: what the selection bar offers on desktop. */}
        {picked && (
          <span className="tool-group tool-touch">
            <Button label="Look up" keys="lookUp" onPress={() => requestLookUp(editor)}>
              <IconBook />
            </Button>
            {onAsk && (
              <>
                <Button label="Synonyms (Construct)" className="tool-text" onPress={() => onAsk(constructPrompt("synonyms", picked.text), picked, true, "synonyms")}>
                  <IconConstruct /> Syn.
                </Button>
                <Button label="Meaning (Construct)" className="tool-text" onPress={() => onAsk(constructPrompt("meaning", picked.text), picked, true, "meaning")}>
                  <IconConstruct /> Mean.
                </Button>
                <Button label="Ask Construct" className="tool-text" onPress={() => onAsk(askDraft(picked.text), picked, false)}>
                  <IconConstruct /> Ask
                </Button>
              </>
            )}
            <span className="tool-sep" aria-hidden />
          </span>
        )}
        <HeadingMenu editor={editor} level={s.level} names={headingNames} />
        <span className="tool-sep" aria-hidden />
        <Button label="Bold" keys="bold" active={s.bold} onPress={() => run().toggleBold().run()}>
          <b className="glyph">B</b>
        </Button>
        <Button label="Italic" keys="italic" active={s.italic} onPress={() => run().toggleItalic().run()}>
          <i className="glyph">I</i>
        </Button>
        <Button label="Strikethrough" keys="strike" active={s.strike} onPress={() => run().toggleStrike().run()}>
          <s className="glyph">S</s>
        </Button>
        <span className="tool-sep" aria-hidden />
        <Button label="Quote" keys="quote" active={s.quote} onPress={() => run().toggleBlockquote().run()}>
          <IconQuote />
        </Button>
        <Button label="Bulleted list" keys="bullets" active={s.bullets} onPress={() => run().toggleBulletList().run()}>
          <IconBullets />
        </Button>
        <Button label="Numbered list" keys="numbers" active={s.numbers} onPress={() => run().toggleOrderedList().run()}>
          <IconNumbers />
        </Button>
        <Button label="Scene break" onPress={() => run().setHorizontalRule().run()}>
          <span className="glyph">⁂</span>
        </Button>
        <Button label="Comment (not counted, kept in the file)" active={s.comment} onPress={() => editor.commands.toggleComment()}>
          <span className="glyph-h">%%</span>
        </Button>
        <span className="tool-sep" aria-hidden />
        <Button label="Undo" keys="undo" disabled={!s.canUndo} onPress={() => run().undo().run()}>
          <IconUndo />
        </Button>
        <Button label="Redo" keys="redo" disabled={!s.canRedo} onPress={() => run().redo().run()}>
          <IconRedo />
        </Button>
      </div>
    </div>
  );
}
