"use client";

import { type Editor, EditorContent } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Citation, findPassage, type LineCitation, parseCitation } from "@/lib/cite";
import { textWithoutComments } from "@/lib/comments";
import type { PromptContext } from "@/lib/construct/types";
import { grammar, useGrammarEnabled } from "@/lib/grammarClient";
import { showPassage } from "@/lib/passage";
import { hasCurlyQuotes, straightenQuotes } from "@/lib/quotes";
import type { Spot } from "@/lib/spot";
import { slugify, wordCount } from "@/lib/text";
import { STATUS_LABEL, type Story, useAutosave } from "@/lib/useAutosave";
import { useFocusMode } from "@/lib/useFocusMode";
import { useLibrary } from "@/lib/useLibrary";
import { useMedia } from "@/lib/useMedia";
import { useSpot } from "@/lib/useSpot";
import { HEADINGS, usePenEditor } from "@/lib/usePenEditor";
import type { VersionMeta } from "@/lib/versions";
import Codex from "./Codex";
import CodexPanel, { type CodexPanelHandle } from "./CodexPanel";
import Construct, { type ConstructRequest } from "./Construct";
import Drawer from "./Drawer";
import DropImport from "./DropImport";
import EditorMenu from "./EditorMenu";
import FocusControls from "./FocusControls";
import GrammarPane, { GrammarCount } from "./GrammarPane";
import GrammarPopover from "./GrammarPopover";
import WordTools from "./WordTools";
import { IconBack, IconCodex, IconConstruct, IconExport, IconFocus, IconGear, IconGrammar, IconManuscript, IconOutline } from "./icons";
import History from "./History";
import Logo from "./Logo";
import Outline, { type Heading } from "./Outline";
import ThemeButton from "./ThemeButton";
import Toolbar from "./Toolbar";
import VersionPreview from "./VersionPreview";

type DrawerTab = "contents" | "codex" | "history" | "grammar";

// Keep in step with the breakpoints in globals.css.
/** Room for a codex entry beside the manuscript. */
const WIDE = "(min-width: 1180px)";
/** Room for the codex entry and Construct at once. */
const ROOMY = "(min-width: 1800px)";

type Props = {
  projectId: string;
  /** The manuscript itself, or one of its codex entries. */
  kind: "manuscript" | "entry";
  initial: Story;
  /** Codex entry to open beside the manuscript (from `?entry=`). */
  initialEntry?: string;
  /** A Construct citation to show once the manuscript is loaded (from `?cite=`). */
  initialCite?: string;
  /** Where the writer last was in this manuscript or entry. */
  initialSpot?: Spot;
  /** The Codex entry viewed last, for the top bar's switch (manuscript only). */
  lastEntry?: { id: string; title: string };
};

export default function Pen({ projectId, kind, initial, initialEntry, initialCite, initialSpot, lastEntry }: Props) {
  const isEntry = kind === "entry";
  const headingNames = HEADINGS[kind];
  const router = useRouter();
  const lib = useLibrary();
  const focusMode = useFocusMode();
  const wide = useMedia(WIDE);
  const roomy = useMedia(ROOMY);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [words, setWords] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [constructOpen, setConstructOpen] = useState(false);
  const [codexKey, setCodexKey] = useState(0);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>(isEntry || initialEntry ? "codex" : "contents");
  const [preview, setPreview] = useState<{ meta: VersionMeta; content: string; cite?: LineCitation } | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const scrollBeforePreview = useRef(0);
  const [typing, setTyping] = useState(false);
  const [progress, setProgress] = useState(0);
  const touchRef = useRef<() => void>(() => {});
  // The codex entry open beside the manuscript, and which editor the toolbar serves.
  const [panelEntry, setPanelEntry] = useState<string | null>(isEntry ? null : (initialEntry ?? null));
  const [panelEditor, setPanelEditor] = useState<Editor | null>(null);
  const [panelTitle, setPanelTitle] = useState<string | undefined>();
  const [panelFocused, setPanelFocused] = useState(false);
  const panel = useRef<CodexPanelHandle>(null);

  const editor = usePenEditor(kind, initial.content, () => {
    touchRef.current();
    setTyping(true);
  });

  const getContent = useCallback(() => (editor ? editor.getMarkdown() : null), [editor]);
  const setContent = useCallback(
    (md: string) => editor?.commands.setContent(md, { contentType: "markdown", emitUpdate: false }),
    [editor],
  );
  const { status, conflict, touch, leave, adopt, pull, resolveConflict } = useAutosave({
    initial,
    url: isEntry ? `/api/docs/${projectId}/codex/${initial.id}` : `/api/docs/${projectId}`,
    backupKey: isEntry ? `pen:backup:${projectId}/codex/${initial.id}` : `pen:backup:${projectId}`,
    getContent,
    setContent,
    ready: !!editor,
  });
  touchRef.current = touch;

  // Reopen where the writer left off, unless a citation brought them here.
  const spotUrl = `/api/docs/${projectId}/spot`;
  const spot = useSpot({
    editor,
    url: spotUrl,
    entry: isEntry ? initial.id : null,
    initial: initialCite ? undefined : initialSpot,
    paused: !!preview,
  });

  // Curly quotes from imports or older text are straightened on open (and saved
  // by autosave). A manuscript gets a version first, so nothing is lost.
  useEffect(() => {
    if (!editor || !hasCurlyQuotes(editor.state.doc)) return;
    void (async () => {
      if (!isEntry) {
        const res = await fetch(`/api/docs/${projectId}/versions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: "Before straightening quotes" }),
        }).catch(() => null);
        if (!res?.ok) return; // try again next time it opens
        setHistoryKey((k) => k + 1);
      }
      const tr = straightenQuotes(editor.state);
      if (tr) editor.view.dispatch(tr);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Derive outline + word count from the document, lightly debounced.
  useEffect(() => {
    if (!editor) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const scan = () => {
      const hs: Heading[] = [];
      editor.state.doc.forEach((node, offset) => {
        if (node.type.name === "heading") {
          hs.push({ pos: offset, level: node.attrs.level as number, text: textWithoutComments(node).trim() });
        }
      });
      setHeadings(hs);
      setWords(wordCount(textWithoutComments(editor.state.doc)));
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
        // Positions lag the doc until the debounced rescan and may land on a text node meanwhile.
        const el = editor.view.nodeDOM(h.pos);
        if (el instanceof HTMLElement && el.getBoundingClientRect().top < window.innerHeight * 0.3) current = h.pos;
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

  const title = headings.find((h) => h.level === 1)?.text || "Untitled";

  const exportMarkdown = () => {
    if (!editor) return;
    const blob = new Blob([editor.getMarkdown()], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(title) || initial.id}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const openPreview = async (meta: VersionMeta, cite?: LineCitation) => {
    const res = await fetch(`/api/docs/${initial.id}/versions/${meta.id}`, { cache: "no-store" });
    if (!res.ok) return false;
    const { content } = (await res.json()) as { content: string };
    if (!preview) scrollBeforePreview.current = window.scrollY;
    setPreview({ meta, content, cite });
    setOutlineOpen(false);
    window.scrollTo(0, 0);
    return true;
  };

  const closePreview = () => {
    setPreview(null);
    requestAnimationFrame(() => window.scrollTo(0, scrollBeforePreview.current));
  };

  const restore = async () => {
    if (!preview) return;
    await leave(); // the "before restore" copy should include the latest keystrokes
    const res = await fetch(`/api/docs/${initial.id}/versions/${preview.meta.id}/restore`, { method: "POST" });
    if (!res.ok) return;
    adopt((await res.json()) as Story);
    setPreview(null);
    setHistoryKey((k) => k + 1);
    window.scrollTo(0, 0);
  };

  // ─── Construct citations ───────────────────────────────────
  /** Settles a version citation once its preview has looked for the passage. */
  const citeShown = useRef<((found: boolean) => void) | null>(null);

  /** Jump to a passage Construct cited. False when it can't be found any more. */
  const cite = async (c: Exclude<Citation, { kind: "codex" }>, href: string): Promise<boolean> => {
    // Passages live on the manuscript's page.
    if (isEntry) {
      void go(`/d/${projectId}?cite=${encodeURIComponent(href)}`);
      return true;
    }
    // Below this width Construct covers the text.
    if (!window.matchMedia(WIDE).matches) setConstructOpen(false);
    if (c.kind === "version") {
      const res = await fetch(`/api/docs/${projectId}/versions`, { cache: "no-store" }).catch(() => null);
      const meta = res?.ok ? ((await res.json()) as VersionMeta[]).find((v) => v.id === c.version) : undefined;
      if (!meta) return false;
      citeShown.current?.(false);
      const shown = new Promise<boolean>((resolve) => (citeShown.current = resolve));
      return (await openPreview(meta, c)) && shown;
    }
    if (!editor) return false;
    const range = findPassage(editor.state.doc, editor.getMarkdown().split("\n"), c);
    if (!range) return false;
    if (preview) {
      setPreview(null);
      // Let the draft show again before measuring it.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    showPassage(editor.view, range);
    return true;
  };

  // A citation followed here from a Codex entry's page (?cite=).
  useEffect(() => {
    const c = editor && initialCite ? parseCitation(initialCite) : null;
    if (c && c.kind !== "codex") void cite(c, initialCite!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const jump = (h: Heading) => {
    if (!editor) return;
    const el = editor.view.nodeDOM(h.pos) as HTMLElement | null;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    editor.commands.setTextSelection(h.pos + 1);
    setOutlineOpen(false);
  };

  // Save before leaving this document, whichever way we leave.
  const go = async (href: string) => {
    await Promise.all([leave(), panel.current?.leave(), spot.leave()]);
    router.push(href);
  };
  const goLibrary = () => go("/?library");
  const openSettings = () => go(`/d/${projectId}/settings`);
  const grammarOn = useGrammarEnabled();
  const toggleGrammar = () => grammar.setEnabled(!grammarOn);

  // ─── Codex entry beside the manuscript ─────────────────────
  const openEntry = async (eid: string) => {
    setOutlineOpen(false);
    if (eid === panelEntry) return;
    await panel.current?.leave();
    setPanelEntry(eid);
    if (!window.matchMedia(ROOMY).matches) setConstructOpen(false);
  };
  const closeEntry = async () => {
    await panel.current?.leave();
    setPanelEntry(null);
    setPanelFocused(false);
  };
  // Drop the panel without saving: its file is gone.
  const dropEntry = () => {
    setPanelEntry(null);
    setPanelFocused(false);
    setCodexKey((k) => k + 1);
  };
  // ─── Switching between the manuscript and the Codex entry viewed last ───
  const [last, setLast] = useState(lastEntry ?? null);
  // Any entry opened counts, beside the manuscript or on its own page.
  const visited = isEntry ? initial.id : panelEntry;
  useEffect(() => {
    if (!visited) return;
    void fetch(spotUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry: visited }),
    }).catch(() => {});
  }, [spotUrl, visited]);
  useEffect(() => {
    if (panelEntry) setLast({ id: panelEntry, title: panelTitle || panelEntry });
  }, [panelEntry, panelTitle]);

  /** Manuscript ⇄ the last entry: a page of its own on phones, the side panel where there's room. */
  const switchView = () => {
    const beside = window.matchMedia(WIDE).matches;
    if (isEntry) return go(beside ? `/d/${projectId}?entry=${encodeURIComponent(initial.id)}` : `/d/${projectId}`);
    if (beside && panelEntry) return closeEntry();
    if (!last) {
      // Nothing viewed yet: show the list instead.
      setDrawerTab("codex");
      setOutlineOpen(true);
      return;
    }
    return beside ? openEntry(last.id) : go(`/d/${projectId}/codex/${last.id}`);
  };
  const switchRef = useRef(switchView);
  switchRef.current = switchView;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        void switchRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const switchLabel = isEntry
    ? "Back to the manuscript"
    : panelEntry
      ? "Close the Codex entry"
      : last
        ? `Codex: ${last.title}`
        : "Codex";

  /** Codex and Construct links: entries open beside the manuscript when there's room. */
  const open = (href: string) => {
    if (isEntry) return go(href);
    const entry = href.match(/^\/d\/[^/]+\/codex\/([^/?#]+)$/)?.[1];
    if (entry && window.matchMedia(WIDE).matches) return openEntry(entry);
    // Codex navigates home after deleting the open entry.
    if (href === `/d/${projectId}` && panelEntry) return dropEntry();
    return go(href);
  };

  // Keep the open entry in the address, so a reload brings it back.
  useEffect(() => {
    if (isEntry) return;
    const url = panelEntry ? `/d/${projectId}?entry=${encodeURIComponent(panelEntry)}` : `/d/${projectId}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, "", url);
  }, [isEntry, projectId, panelEntry]);

  // No room: close the panel (or, when both are open, Construct).
  useEffect(() => {
    if (wide === false && panelEntry) void closeEntry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide]);
  useEffect(() => {
    if (roomy === false && panelEntry && constructOpen) setConstructOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomy]);

  // The toolbar and Construct follow whichever editor was used last.
  useEffect(() => {
    if (!editor) return;
    const onMain = () => setPanelFocused(false);
    editor.on("focus", onMain);
    return () => {
      editor.off("focus", onMain);
    };
  }, [editor]);
  useEffect(() => {
    if (!panelEditor) return;
    const onPanel = () => setPanelFocused(true);
    panelEditor.on("focus", onPanel);
    return () => {
      panelEditor.off("focus", onPanel);
    };
  }, [panelEditor]);
  const inPanel = panelFocused && !!panelEditor && !!panelEntry;
  const toolEditor = inPanel ? panelEditor : editor;
  const onPanelTyping = useCallback(() => setTyping(true), []);

  // ─── Construct ─────────────────────────────────────────────
  /** Where the writer is in `ed`, and what they've selected there (or in `range`). */
  const contextIn = (ed: Editor | null, range?: { from: number; to: number }): PromptContext => {
    const context: PromptContext =
      ed && ed === panelEditor ? { entry: panelEntry! } : isEntry ? { entry: initial.id } : {};
    const sel = range ?? (ed && !ed.state.selection.empty ? ed.state.selection : null);
    if (ed && sel) {
      const text = ed.state.doc.textBetween(sel.from, sel.to, "\n").trim();
      if (text) context.selection = text;
      const $from = ed.state.doc.resolve(sel.from);
      if (text && $from.sameParent(ed.state.doc.resolve(sel.to)) && $from.parent.isTextblock) {
        context.paragraph = $from.parent.textContent;
      }
    }
    return context;
  };
  const constructContext = () => contextIn(toolEditor);

  // Look-up and grammar buttons that ask Construct: into the chat that's open.
  const [constructRequest, setConstructRequest] = useState<ConstructRequest | null>(null);
  const askConstruct = (ed: Editor) => (text: string, range: { from: number; to: number }, send: boolean) => {
    setConstructRequest({ id: Date.now(), text, context: contextIn(ed, range), send });
    setOutlineOpen(false);
    if (!constructOpen && panelEntry && ed !== panelEditor && !window.matchMedia(ROOMY).matches) void closeEntry();
    setConstructOpen(true);
  };
  const beforeConstruct = async () => {
    await Promise.all([leave(), panel.current?.leave()]);
  };
  const onCodexChange = ({ entry, action, to }: { entry: string; action: string; to?: string }) => {
    setCodexKey((k) => k + 1);
    if (entry === last?.id) {
      if (action === "deleted") setLast(null);
      if (action === "renamed" && to) setLast({ ...last, id: to });
    }
    if (!isEntry) {
      if (entry !== panelEntry) return;
      if (action === "edited") void panel.current?.pull();
      if (action === "renamed" && to) setPanelEntry(to);
      if (action === "deleted") dropEntry();
      return;
    }
    if (entry !== initial.id) return;
    if (action === "edited") void pull(); // skipped if we have unsaved typing: the next save then conflicts
    if (action === "renamed" && to) router.replace(`/d/${projectId}/codex/${to}`);
  };
  const { importFile: importDoc } = lib;
  const importFile = useCallback(
    async (file: File) => {
      await leave();
      await importDoc(file);
    },
    [leave, importDoc],
  );

  const toggleFocus = () => {
    setOutlineOpen(false);
    setConstructOpen(false);
    focusMode.toggle();
  };
  const toggleConstruct = () => {
    setOutlineOpen(false);
    if (!constructOpen && panelEntry && !window.matchMedia(ROOMY).matches) void closeEntry();
    setConstructOpen((o) => !o);
  };

  return (
    <div
      className={`app app-editor ${typing ? "is-typing" : ""} ${focusMode.toolbarShown ? "toolbar-shown" : ""} ${constructOpen ? "construct-open" : ""} ${panelEntry ? "codex-open" : ""}`}
    >
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
          <button type="button" className="wordmark" onClick={goLibrary} title="Library" aria-label="Library">
            <Logo />
          </button>
          <span className="topbar-title" title={title}>
            {isEntry ? `Codex · ${title}` : title}
          </span>
        </div>
        <div className="topbar-right">
          {status === "locked" ? (
            <a
              className="status status-locked"
              href={`/unlock?next=${encodeURIComponent(`/d/${initial.id}`)}`}
              role="status"
              title="Signed out. Unlock to keep saving; your text is kept on this device."
            >
              <span className="status-dot" aria-hidden />
              <span className="status-label">Locked · unlock</span>
            </a>
          ) : (
            <span className={`status status-${status}`} role="status" aria-live="polite">
              <span className="status-dot" aria-hidden />
              <span className="status-label">{STATUS_LABEL[status]}</span>
            </span>
          )}
          <button
            type="button"
            className={`icon-btn ${panelEntry ? "is-on" : ""}`}
            onClick={() => void switchView()}
            aria-label={switchLabel}
            title={`${switchLabel} (Ctrl+Shift+E)`}
          >
            {isEntry ? <IconManuscript /> : <IconCodex />}
          </button>
          {/* Inline on wider screens; folded into EditorMenu on phones (CSS picks one). */}
          <div className="topbar-tools">
            <span className="words label">{words.toLocaleString()} w</span>
            <button
              type="button"
              className="icon-btn"
              onClick={toggleFocus}
              aria-label="Focus mode"
              title="Focus mode (Ctrl+Shift+F)"
            >
              <IconFocus />
            </button>
            <ThemeButton />
            <button
              type="button"
              className={`icon-btn ${grammarOn ? "is-on" : ""}`}
              onClick={toggleGrammar}
              aria-label="Grammar check"
              aria-pressed={grammarOn}
              title={grammarOn ? "Grammar check: on" : "Grammar check: off"}
            >
              <IconGrammar />
            </button>
            <button type="button" className="icon-btn" onClick={exportMarkdown} aria-label="Export markdown" title="Export .md">
              <IconExport />
            </button>
            <button
              type="button"
              className={`icon-btn construct-toggle ${constructOpen ? "is-on" : ""}`}
              onClick={toggleConstruct}
              aria-label="Construct"
              aria-expanded={constructOpen}
              title="Construct"
            >
              <IconConstruct />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={openSettings}
              aria-label="Book settings"
              title="Book settings"
            >
              <IconGear />
            </button>
          </div>
          <EditorMenu
            status={STATUS_LABEL[status]}
            words={words}
            constructOpen={constructOpen}
            onFocus={toggleFocus}
            grammarOn={grammarOn}
            onGrammar={toggleGrammar}
            onExport={exportMarkdown}
            onConstruct={toggleConstruct}
            onSettings={openSettings}
          />
        </div>
      </header>

      {conflict && (
        <div className="conflict" role="alert">
          <p>
            <span className="label">Conflict</span>
            This manuscript was changed on another device.
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

      <Drawer
        open={outlineOpen}
        onClose={() => setOutlineOpen(false)}
        label="Outline"
        head={
          isEntry ? (
            <button type="button" className="drawer-back" onClick={() => go(`/d/${projectId}`)}>
              <IconBack /> Manuscript
            </button>
          ) : (
            <button type="button" className="drawer-back" onClick={goLibrary}>
              <IconBack /> Library
            </button>
          )
        }
        foot={`${words.toLocaleString()} words · ${Math.max(1, Math.round(words / 230))} min read`}
      >
        <div className="drawer-tabs" role="tablist">
          {(["contents", "codex", ...(isEntry ? [] : ["history"]), "grammar"] as DrawerTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={drawerTab === tab}
              onClick={() => setDrawerTab(tab)}
            >
              {tab}
              {tab === "grammar" && <GrammarCount editor={editor} />}
            </button>
          ))}
        </div>
        {drawerTab === "contents" && (
          <Outline headings={headings} active={active} onJump={jump} plain={isEntry} />
        )}
        {drawerTab === "grammar" && (
          <GrammarPane editor={editor} headings={headings} onShown={() => setOutlineOpen(false)} />
        )}
        {drawerTab === "codex" && (
          <Codex
            projectId={projectId}
            activeId={isEntry ? initial.id : panelEntry}
            activeTitle={isEntry ? title : panelTitle}
            onOpen={open}
            refreshKey={codexKey}
          />
        )}
        {drawerTab === "history" && !isEntry && (
          <History
            docId={initial.id}
            refreshKey={historyKey}
            previewing={preview?.meta.id ?? null}
            beforeSave={leave}
            onPreview={openPreview}
            onRenamed={(meta) => setPreview((p) => (p && p.meta.id === meta.id ? { ...p, meta } : p))}
          />
        )}
      </Drawer>

      <main className="page">
        {preview && (
          <VersionPreview
            key={preview.meta.id}
            meta={preview.meta}
            content={preview.content}
            cite={preview.cite}
            onCited={(found) => {
              citeShown.current?.(found);
              citeShown.current = null;
            }}
            draft={editor?.state.doc ?? null}
            onRestore={restore}
            onClose={closePreview}
          />
        )}
        {/* The live draft stays mounted underneath a preview. */}
        <div hidden={!!preview}>
          {editor ? <EditorContent editor={editor} /> : <div className="prose loading" aria-busy />}
        </div>
      </main>

      {panelEntry && (
        <CodexPanel
          key={panelEntry}
          projectId={projectId}
          entryId={panelEntry}
          handle={panel}
          onClose={closeEntry}
          onExpand={() => go(`/d/${projectId}/codex/${panelEntry}`)}
          onMissing={dropEntry}
          onEditor={setPanelEditor}
          onTitle={setPanelTitle}
          onChange={onPanelTyping}
        />
      )}

      {toolEditor && (!preview || inPanel) && (
        <Toolbar
          key={inPanel ? "panel" : "main"}
          editor={toolEditor}
          onAsk={askConstruct(toolEditor)}
          headingNames={inPanel ? HEADINGS.entry : headingNames}
        />
      )}

      <Construct
        projectId={projectId}
        open={constructOpen}
        onClose={() => setConstructOpen(false)}
        getContext={constructContext}
        beforeSend={beforeConstruct}
        onCodexChange={onCodexChange}
        onOpen={open}
        onCite={cite}
        request={constructRequest}
      />

      {lib.error && (
        <div className="toast" role="alert" onClick={lib.clearError}>
          {lib.error}
        </div>
      )}
      {focusMode.focus && (
        <FocusControls
          pinned={focusMode.pinned}
          onToggleToolbar={focusMode.togglePinned}
          onExit={focusMode.exit}
        />
      )}
      <DropImport onFile={importFile} />
      {editor && <GrammarPopover editor={editor} onAsk={(text, range) => askConstruct(editor)(text, range, true)} />}
      {panelEditor && (
        <GrammarPopover editor={panelEditor} onAsk={(text, range) => askConstruct(panelEditor)(text, range, true)} />
      )}
      {editor && <WordTools editor={editor} onAsk={askConstruct(editor)} />}
      {panelEditor && <WordTools editor={panelEditor} onAsk={askConstruct(panelEditor)} />}
    </div>
  );
}
