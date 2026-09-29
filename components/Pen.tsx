"use client";

import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Typography from "@tiptap/extension-typography";
import { Placeholder } from "@tiptap/extensions";
import { useCallback, useEffect, useRef, useState } from "react";
import { type SaveStatus, type Story, useAutosave } from "@/lib/useAutosave";
import { IconExport, IconOutline, IconTheme } from "./icons";
import Outline, { type Heading } from "./Outline";
import Toolbar from "./Toolbar";

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Unsaved",
  saving: "Saving",
  offline: "Offline",
  conflict: "Conflict",
};

type Theme = "auto" | "light" | "dark";
const THEME_LABEL: Record<Theme, string> = { auto: "Auto", light: "Paper", dark: "Night" };

function countWords(text: string) {
  const m = text.match(/[\p{L}\p{N}’'-]+/gu);
  return m ? m.length : 0;
}

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "story"
  );
}

export default function Pen({ initial }: { initial: Story }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [words, setWords] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [theme, setTheme] = useState<Theme>("auto");
  const [progress, setProgress] = useState(0);
  const touchRef = useRef<() => void>(() => {});

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false },
      }),
      Markdown,
      Typography.configure({
        // Keep the literary substitutions; drop the ones that ambush prose.
        oneHalf: false,
        oneQuarter: false,
        threeQuarters: false,
        plusMinus: false,
        notEqual: false,
        multiplication: false,
        superscriptTwo: false,
        superscriptThree: false,
        leftArrow: false,
        rightArrow: false,
        copyright: false,
        registeredTrademark: false,
        trademark: false,
        servicemark: false,
        laquo: false,
        raquo: false,
      }),
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "heading" ? "Heading" : "Begin anywhere…",
      }),
    ],
    content: initial.content,
    contentType: "markdown",
    editorProps: {
      attributes: { class: "prose", spellcheck: "true", "aria-label": "Manuscript" },
    },
    onUpdate: ({ transaction }) => {
      if (transaction.docChanged) {
        touchRef.current();
        setTyping(true);
      }
    },
  });

  const getContent = useCallback(() => (editor ? editor.getMarkdown() : null), [editor]);
  const setContent = useCallback(
    (md: string) => editor?.commands.setContent(md, { contentType: "markdown", emitUpdate: false }),
    [editor],
  );
  const { status, conflict, touch, resolveConflict } = useAutosave({
    initial,
    getContent,
    setContent,
    ready: !!editor,
  });
  touchRef.current = touch;

  // Derive outline + word count from the document, lightly debounced.
  useEffect(() => {
    if (!editor) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const scan = () => {
      const hs: Heading[] = [];
      editor.state.doc.forEach((node, offset) => {
        if (node.type.name === "heading") {
          hs.push({ pos: offset, level: node.attrs.level as number, text: node.textContent.trim() });
        }
      });
      setHeadings(hs);
      setWords(countWords(editor.state.doc.textBetween(0, editor.state.doc.content.size, " ", " ")));
    };
    const onTx = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      if (t) clearTimeout(t);
      t = setTimeout(scan, 200);
    };
    scan();
    editor.on("transaction", onTx);
    return () => {
      editor.off("transaction", onTx);
      if (t) clearTimeout(t);
    };
  }, [editor]);

  // Track the heading in view and overall reading progress.
  useEffect(() => {
    if (!editor) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
      let current: number | null = headings[0]?.pos ?? null;
      for (const h of headings) {
        const el = editor.view.nodeDOM(h.pos) as HTMLElement | null;
        if (el && el.getBoundingClientRect().top < window.innerHeight * 0.3) current = h.pos;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
      setTyping(false);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [editor, headings]);

  // Lift the toolbar above the on-screen keyboard (iOS doesn't resize the layout).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--kb", `${kb}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Chrome fades while typing and returns on pointer movement.
  useEffect(() => {
    const wake = () => setTyping(false);
    window.addEventListener("mousemove", wake);
    return () => window.removeEventListener("mousemove", wake);
  }, []);

  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setTheme(t === "light" || t === "dark" ? t : "auto");
  }, []);

  const cycleTheme = () => {
    const next: Theme = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto";
    setTheme(next);
    const root = document.documentElement;
    try {
      if (next === "auto") {
        delete root.dataset.theme;
        localStorage.removeItem("pen:theme");
      } else {
        root.dataset.theme = next;
        localStorage.setItem("pen:theme", next);
      }
    } catch {}
  };

  const title = headings.find((h) => h.level === 1)?.text || "Untitled";

  const exportMarkdown = () => {
    if (!editor) return;
    const blob = new Blob([editor.getMarkdown()], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(title)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const jump = (h: Heading) => {
    if (!editor) return;
    const el = editor.view.nodeDOM(h.pos) as HTMLElement | null;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    editor.commands.setTextSelection(h.pos + 1);
    setOutlineOpen(false);
  };

  return (
    <div className={`app ${typing ? "is-typing" : ""}`}>
      <div className="progress" style={{ transform: `scaleX(${progress})` }} aria-hidden />

      <header className="topbar">
        <div className="topbar-left">
          <button
            type="button"
            className="icon-btn outline-toggle"
            onClick={() => setOutlineOpen((o) => !o)}
            aria-label="Outline"
            aria-expanded={outlineOpen}
          >
            <IconOutline />
          </button>
          <span className="wordmark">pen</span>
          <span className="topbar-title" title={title}>
            {title}
          </span>
        </div>
        <div className="topbar-right">
          <span className={`status status-${status}`} role="status" aria-live="polite">
            <span className="status-dot" aria-hidden />
            <span className="status-label">{STATUS_LABEL[status]}</span>
          </span>
          <span className="words label">{words.toLocaleString()} w</span>
          <button
            type="button"
            className="icon-btn"
            onClick={cycleTheme}
            aria-label={`Theme: ${THEME_LABEL[theme]}`}
            title={`Theme: ${THEME_LABEL[theme]}`}
          >
            <IconTheme />
          </button>
          <button type="button" className="icon-btn" onClick={exportMarkdown} aria-label="Export markdown" title="Export .md">
            <IconExport />
          </button>
        </div>
      </header>

      {conflict && (
        <div className="conflict" role="alert">
          <p>
            <span className="label">Conflict</span>
            This story was changed on another device.
          </p>
          <div className="conflict-actions">
            <button type="button" onClick={() => resolveConflict("theirs")}>
              Load theirs
            </button>
            <button type="button" className="primary" onClick={() => resolveConflict("mine")}>
              Keep mine
            </button>
          </div>
        </div>
      )}

      <Outline
        headings={headings}
        active={active}
        open={outlineOpen}
        words={words}
        onJump={jump}
        onClose={() => setOutlineOpen(false)}
      />

      <main className="page">
        {editor ? <EditorContent editor={editor} /> : <div className="prose loading" aria-busy />}
      </main>

      {editor && <Toolbar editor={editor} />}
    </div>
  );
}
