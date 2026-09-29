"use client";

import { type Editor, useEditorState } from "@tiptap/react";
import { IconBullets, IconNumbers, IconQuote, IconRedo, IconUndo } from "./icons";

type ButtonProps = {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
  className?: string;
};

function Button({ label, active, disabled, onPress, children, className }: ButtonProps) {
  return (
    <button
      type="button"
      className={`tool ${className ?? ""}`}
      aria-label={label}
      title={label}
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

export default function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      quote: e.isActive("blockquote"),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const run = () => editor.chain().focus();

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <div className="toolbar-scroll">
        <Button label="Title heading" active={s.h1} onPress={() => run().toggleHeading({ level: 1 }).run()}>
          <span className="glyph-h">H1</span>
        </Button>
        <Button label="Chapter heading" active={s.h2} onPress={() => run().toggleHeading({ level: 2 }).run()}>
          <span className="glyph-h">H2</span>
        </Button>
        <span className="tool-sep" aria-hidden />
        <Button label="Bold" active={s.bold} onPress={() => run().toggleBold().run()}>
          <b className="glyph">B</b>
        </Button>
        <Button label="Italic" active={s.italic} onPress={() => run().toggleItalic().run()}>
          <i className="glyph">I</i>
        </Button>
        <Button label="Strikethrough" active={s.strike} onPress={() => run().toggleStrike().run()}>
          <s className="glyph">S</s>
        </Button>
        <span className="tool-sep" aria-hidden />
        <Button label="Quote" active={s.quote} onPress={() => run().toggleBlockquote().run()}>
          <IconQuote />
        </Button>
        <Button label="Bulleted list" active={s.bullets} onPress={() => run().toggleBulletList().run()}>
          <IconBullets />
        </Button>
        <Button label="Numbered list" active={s.numbers} onPress={() => run().toggleOrderedList().run()}>
          <IconNumbers />
        </Button>
        <Button label="Scene break" onPress={() => run().setHorizontalRule().run()}>
          <span className="glyph">⁂</span>
        </Button>
        <span className="tool-sep" aria-hidden />
        <Button label="Undo" disabled={!s.canUndo} onPress={() => run().undo().run()}>
          <IconUndo />
        </Button>
        <Button label="Redo" disabled={!s.canRedo} onPress={() => run().redo().run()}>
          <IconRedo />
        </Button>
      </div>
    </div>
  );
}
