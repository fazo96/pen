"use client";

import { type Editor, useEditorState } from "@tiptap/react";
import type { ShortcutId } from "@/lib/shortcuts";
import { useKeys } from "@/lib/useKeys";
import { askDraft, constructPrompt, pickedWords, requestLookUp } from "@/lib/wordTools";
import { IconBook, IconBullets, IconConstruct, IconNumbers, IconQuote, IconRedo, IconUndo } from "./icons";
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

type Props = {
  editor: Editor;
  /** Names for heading levels 1–3, shown as tooltips. */
  headingNames: readonly string[];
  onAsk: Ask;
};

export default function Toolbar({ editor, headingNames, onAsk }: Props) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
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
            <Button label="Synonyms (Construct)" className="tool-text" onPress={() => onAsk(constructPrompt("synonyms", picked.text), picked, true)}>
              <IconConstruct /> Syn.
            </Button>
            <Button label="Meaning (Construct)" className="tool-text" onPress={() => onAsk(constructPrompt("meaning", picked.text), picked, true)}>
              <IconConstruct /> Mean.
            </Button>
            <Button label="Ask Construct" className="tool-text" onPress={() => onAsk(askDraft(picked.text), picked, false)}>
              <IconConstruct /> Ask
            </Button>
            <span className="tool-sep" aria-hidden />
          </span>
        )}
        <Button label={headingNames[0]} keys="h1" active={s.h1} onPress={() => run().toggleHeading({ level: 1 }).run()}>
          <span className="glyph-h">H1</span>
        </Button>
        <Button label={headingNames[1]} keys="h2" active={s.h2} onPress={() => run().toggleHeading({ level: 2 }).run()}>
          <span className="glyph-h">H2</span>
        </Button>
        <Button label={headingNames[2]} keys="h3" active={s.h3} onPress={() => run().toggleHeading({ level: 3 }).run()}>
          <span className="glyph-h">H3</span>
        </Button>
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
