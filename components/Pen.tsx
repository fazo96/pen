"use client";

import { type Editor, EditorContent } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, createEntry, saveVersion as postVersion } from "@/lib/api";
import { type Citation, findPassage, type LineCitation, parseCitation } from "@/lib/cite";
import { textWithoutComments } from "@/lib/comments";
import type { PromptContext } from "@/lib/construct/types";
import { step } from "@/lib/findPlugin";
import { grammar, useGrammarEnabled } from "@/lib/grammarClient";
import { showPassage } from "@/lib/passage";
import { hasCurlyQuotes, straightenQuotes } from "@/lib/quotes";
import type { Spot } from "@/lib/spot";
import { slugify, wordCount } from "@/lib/text";
import { STATUS_LABEL, type Story, useAutosave } from "@/lib/useAutosave";
import { useFocusMode } from "@/lib/useFocusMode";
import { useKeys } from "@/lib/useKeys";
import { useLibrary } from "@/lib/useLibrary";
import { useMedia } from "@/lib/useMedia";
import { useSpot } from "@/lib/useSpot";
import { setSteady, useSteady } from "@/lib/useSteady";
import { roman } from "@/lib/outline";
import { HEADINGS, usePenEditor } from "@/lib/usePenEditor";
import { useTheme, THEME_LABEL, type Theme } from "@/lib/useTheme";
import type { VersionMeta } from "@/lib/types";
import { askDraft, constructPrompt, pickedWords, type QuickKind, requestLookUp } from "@/lib/wordTools";
import Codex from "./Codex";
import CodexPanel, { type CodexPanelHandle } from "./CodexPanel";
import Construct, { type ConstructRequest } from "./Construct";
import Drawer from "./Drawer";
import FindBar, { type FindMode } from "./FindBar";
import WordStats from "./WordStats";
import DropImport from "./DropImport";
import EditorMenu from "./EditorMenu";
import FocusControls from "./FocusControls";
import GrammarPane, { GrammarCount } from "./GrammarPane";
import GrammarPopover from "./GrammarPopover";
import QuickAnswer, { type Quick } from "./QuickAnswer";
import WordTools from "./WordTools";
import { IconBack, IconCodex, IconConstruct, IconExport, IconFocus, IconGear, IconGrammar, IconManuscript, IconOutline } from "./icons";
import History from "./History";
import Logo from "./Logo";
import Outline, { type Heading } from "./Outline";
import Palette, { type PaletteItem, type PaletteMode, usePaletteLists } from "./Palette";
import ThemeButton from "./ThemeButton";
import Toolbar from "./Toolbar";
import VersionPreview from "./VersionPreview";

type DrawerTab = "contents" | "codex" | "history" | "grammar";

// Keep in step with the breakpoints in globals.css.
/** Room for a codex entry beside the manuscript. */
const WIDE = "(min-width: 1180px)";
/** Room for the codex entry and Construct at once. */
const ROOMY = "(min-width: 1800px)";
/** sessionStorage: put the cursor in the next page's text (set by the jumps, Ctrl+Shift+M and so on). */
const FOCUS_ON_ARRIVAL = "pen:focus-on-arrival";

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
  /** Codex entries by when they were viewed, the most recent first (for the quick switcher). */
  recentEntries?: string[];
  /** Whether pen's AI features are on (an agent was found on the server): Construct and its questions. */
  ai: boolean;
};

export default function Pen({
  projectId,
  ai,
  kind,
  initial,
  initialEntry,
  initialCite,
  initialSpot,
  lastEntry,
  recentEntries,
}: Props) {
  const isEntry = kind === "entry";
  const headingNames = HEADINGS[kind];
  const router = useRouter();
  const lib = useLibrary();
  const focusMode = useFocusMode();
  const keys = useKeys();
  const steady = useSteady();
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
  // Tagged with its entry, so one opening never shows the last one's title.
  const [panelTitled, setPanelTitled] = useState<{ id: string; title: string } | null>(null);
  const panelTitle = panelTitled?.id === panelEntry ? panelTitled.title || undefined : undefined;
  const onPanelTitle = useCallback((id: string, title: string) => setPanelTitled({ id, title }), []);
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
        const saved = await postVersion(projectId, "Before straightening quotes").then(
          () => true,
          () => false,
        );
        if (!saved) return; // try again next time it opens
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

  // Empty until the editor has been scanned.
  const h1 = headings.find((h) => h.level === 1)?.text;
  const title = h1 || "Untitled";

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
    const version = await api<{ content: string }>(`/api/docs/${initial.id}/versions/${meta.id}`).catch(() => null);
    if (!version) return false;
    const { content } = version;
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
    const story = await api<Story>(`/api/docs/${initial.id}/versions/${preview.meta.id}/restore`, { method: "POST" }).catch(
      () => null,
    );
    if (!story) return;
    adopt(story);
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
      const versions = await api<VersionMeta[]>(`/api/docs/${projectId}/versions`).catch(() => null);
      const meta = versions?.find((v) => v.id === c.version);
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
    void api(spotUrl, { method: "PUT", json: { entry: visited } }).catch(() => {});
  }, [spotUrl, visited]);
  useEffect(() => {
    if (panelEntry) setLast((l) => ({ id: panelEntry, title: panelTitle || (l?.id === panelEntry ? l.title : panelEntry) }));
  }, [panelEntry, panelTitle]);

  /** The Codex panel's editor was used last (not the manuscript's). */
  const inPanel = panelFocused && !!panelEditor && !!panelEntry;
  /**
   * Manuscript ⇄ the last entry: a page of its own on phones, the side panel where there's
   * room. With the panel open, the cursor goes between the two and the panel stays.
   */
  const switchView = () => {
    if (isEntry) return toManuscript();
    return panelEntry && inPanel ? toManuscript() : toCodex();
  };
  const switchLabel = isEntry
    ? "Back to the manuscript"
    : panelEntry
      ? inPanel
        ? "Back to the manuscript"
        : `Codex: ${panelTitle || panelEntry}`
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

  // Look-up and grammar buttons that ask Construct: a quick answer in a popover
  // (the quick-action model, outside the chat), or a question left in the
  // chat's input to finish.
  const [constructRequest, setConstructRequest] = useState<ConstructRequest | null>(null);
  const [quick, setQuick] = useState<Quick | null>(null);
  const closeQuick = useCallback(() => setQuick(null), []);
  const askConstruct = (ed: Editor) => (text: string, range: { from: number; to: number }, send: boolean, kind?: QuickKind) => {
    if (!send) return askChat(ed, text, range, false);
    const context = contextIn(ed, range);
    setQuick({ id: Date.now(), editor: ed, from: range.from, to: range.to, text: ed.state.doc.textBetween(range.from, range.to, " ", " "), prompt: text, context, kind });
  };
  const askChat = (ed: Editor, text: string, range: { from: number; to: number }, send: boolean) => {
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

  // ─── Quick switcher (Ctrl+O) and commands (Ctrl+P, Ctrl+K) ──────
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  /** The editor that had the cursor when the palette opened, to give it back. */
  const paletteFrom = useRef<Editor | null>(null);
  const paletteFocus = useRef<HTMLElement | null>(null);
  const lists = usePaletteLists(projectId, !!palette);
  const [recent, setRecent] = useState(recentEntries ?? []);
  useEffect(() => {
    if (visited) setRecent((r) => [visited, ...r.filter((e) => e !== visited)]);
  }, [visited]);
  const [newChat, setNewChat] = useState(0);
  const [compactChat, setCompactChat] = useState(0);
  const { cycle: cycleTheme } = useTheme();
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const togglePalette = (mode: PaletteMode) => {
    if (palette === mode) return closePalette(true);
    if (!palette) {
      paletteFrom.current = toolEditor?.isFocused ? toolEditor : null;
      // Anything else that had focus (Construct's input, a button) gets it back too.
      const el = document.activeElement;
      paletteFocus.current = !paletteFrom.current && el instanceof HTMLElement && el !== document.body ? el : null;
    }
    setPalette(mode);
  };
  const closePalette = (refocus: boolean) => {
    setPalette(null);
    const ed = paletteFrom.current;
    const el = paletteFocus.current;
    if (refocus && ed && !ed.isDestroyed) requestAnimationFrame(() => ed.view.focus());
    else if (refocus && el?.isConnected) requestAnimationFrame(() => el.focus());
  };
  const paletteKeys = useRef(togglePalette);
  paletteKeys.current = togglePalette;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const mode: PaletteMode | null = k === "o" ? "go" : k === "p" || k === "k" ? "do" : null;
      if (!mode) return;
      // Before the browser's Open and Print, and before the editor sees it.
      e.preventDefault();
      e.stopPropagation();
      paletteKeys.current(mode);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // ─── Jumping between the manuscript, the Codex and Construct ───
  /** The cursor into `ed`; not on touch screens, where it would bring up the keyboard. */
  const focusText = (ed: Editor | null) => {
    if (!ed || ed.isDestroyed || window.matchMedia("(hover: none)").matches) return;
    requestAnimationFrame(() => !ed.isDestroyed && ed.view.focus());
  };
  /** To another page, with the cursor in its text once it opens. */
  const goAndFocus = (href: string) => {
    try {
      sessionStorage.setItem(FOCUS_ON_ARRIVAL, String(Date.now()));
    } catch {}
    return go(href);
  };
  useEffect(() => {
    if (!editor) return;
    try {
      const at = Number(sessionStorage.getItem(FOCUS_ON_ARRIVAL));
      sessionStorage.removeItem(FOCUS_ON_ARRIVAL);
      if (Date.now() - at < 10_000) focusText(editor);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);
  // The panel's editor appears once its entry has loaded.
  const panelFocusWanted = useRef(false);
  useEffect(() => {
    if (!panelEditor || !panelFocusWanted.current) return;
    panelFocusWanted.current = false;
    focusText(panelEditor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelEditor]);

  const toManuscript = () => {
    setOutlineOpen(false);
    if (isEntry) {
      const beside = window.matchMedia(WIDE).matches;
      return goAndFocus(beside ? `/d/${projectId}?entry=${encodeURIComponent(initial.id)}` : `/d/${projectId}`);
    }
    if (preview) closePreview();
    focusText(editor);
  };
  /** The entry beside the manuscript, else the one viewed last, else the Codex's list. */
  const toCodex = () => {
    if (isEntry) {
      setOutlineOpen(false);
      return focusText(editor);
    }
    const beside = window.matchMedia(WIDE).matches;
    if (beside && panelEntry) {
      setOutlineOpen(false);
      if (panelEditor) return focusText(panelEditor);
      panelFocusWanted.current = true;
      return;
    }
    if (!last) return showTab("codex");
    if (!beside) return goAndFocus(`/d/${projectId}/codex/${last.id}`);
    panelFocusWanted.current = true;
    return openEntry(last.id);
  };
  /** Closed from its ✕ or the palette: the cursor goes back to the text. */
  const closeConstruct = () => {
    setConstructOpen(false);
    focusText(toolEditor);
  };
  const [constructFocus, setConstructFocus] = useState(0);
  const toConstruct = () => {
    if (constructOpen) setOutlineOpen(false);
    else toggleConstruct();
    setConstructFocus((n) => n + 1);
  };
  const jumps = useRef({ switchView, toManuscript, toCodex, toConstruct, closePalette });
  jumps.current = { switchView, toManuscript, toCodex, toConstruct, closePalette };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      const j = jumps.current;
      const jump = { e: j.switchView, m: j.toManuscript, x: j.toCodex, a: ai ? j.toConstruct : undefined }[e.key.toLowerCase()];
      if (!jump) return;
      e.preventDefault();
      e.stopPropagation();
      j.closePalette(false);
      void jump();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ai]);

  // ─── Find and replace (Ctrl+F, Ctrl+H) ─────────────────────
  /** The editor searched, and a key bumped by each Ctrl+F to refocus the bar. */
  const [find, setFind] = useState<{ editor: Editor; mode: FindMode; key: number } | null>(null);
  /** In the editor used last; false when there's none to search (a version preview covers it). */
  const openFind = (mode: FindMode) => {
    const target = preview && !inPanel ? null : toolEditor;
    if (!target) return false;
    closePalette(false);
    setOutlineOpen(false);
    setFind((f) => ({ editor: target, mode, key: (f?.key ?? 0) + 1 }));
    return true;
  };
  const closeFind = (refocus: boolean) => {
    const ed = find?.editor;
    setFind(null);
    if (refocus && ed && !ed.isDestroyed) requestAnimationFrame(() => !ed.isDestroyed && ed.view.focus());
  };
  // Its editor gone (the panel closed) or covered (a preview opened): the bar goes too.
  const findGone = !!find && (find.editor.isDestroyed || (find.editor !== editor && find.editor !== panelEditor) || (find.editor === editor && !!preview));
  useEffect(() => {
    if (findGone) setFind(null);
  }, [findGone]);
  const finds = useRef({ openFind, find });
  finds.current = { openFind, find };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const { openFind, find } = finds.current;
      const mod = !e.shiftKey && !e.altKey;
      if (mod && e.code === "KeyF") {
        // Ctrl+F in the bar: the browser's own find, for everything else on the page.
        if ((document.activeElement as Element | null)?.closest(".find-bar")) return;
        if (openFind("find")) e.preventDefault();
      } else if ((mod && e.code === "KeyH") || (!e.shiftKey && e.altKey && e.code === "KeyF")) {
        if (openFind("replace")) e.preventDefault();
      } else if (!e.altKey && e.code === "KeyG" && find && !find.editor.isDestroyed) {
        e.preventDefault();
        step(find.editor.view, e.shiftKey ? -1 : 1);
      } else return;
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const findBar = (ed: Editor | null) =>
    find &&
    find.editor === ed &&
    !findGone && (
      <FindBar
        editor={find.editor}
        mode={find.mode}
        focusKey={find.key}
        onMode={(mode) => setFind((f) => f && { ...f, mode })}
        onClose={closeFind}
        onReplaced={(n) => setNotice(n ? `Replaced ${n} ${n === 1 ? "match" : "matches"}` : "Nothing to replace")}
      />
    );

  const showTab = (tab: DrawerTab) => {
    setDrawerTab(tab);
    setOutlineOpen(true);
  };
  const saveVersion = async (label: string) => {
    try {
      await leave(); // the version should include the latest keystrokes
      await postVersion(initial.id, label);
      setHistoryKey((k) => k + 1);
      setNotice(label ? `Saved version “${label}”` : "Saved a version");
    } catch {
      setNotice("Couldn’t save the version.");
    }
  };
  const newEntry = async () => {
    try {
      const eid = await createEntry(projectId);
      setCodexKey((k) => k + 1);
      void open(`/d/${projectId}/codex/${eid}`);
    } catch {
      setNotice("Couldn’t create the entry.");
    }
  };

  /** Where the switcher can go: the switch, recent entries, headings, the Codex, other books. */
  const places = (): PaletteItem[] => {
    const items: PaletteItem[] = [];
    const here = isEntry ? initial.id : panelEntry;
    const titles = new Map((lists.entries ?? []).map((e) => [e.id, e.title]));
    if (isEntry || panelEntry || last) {
      // Searchable on an entry's page, where it's the way back; elsewhere it repeats an entry.
      items.push({
        key: "switch",
        section: "Recent",
        label: switchLabel,
        hint: keys.key("switch"),
        when: isEntry ? undefined : "empty",
        run: switchView,
      });
    }
    const target = !isEntry && !panelEntry ? last?.id : undefined;
    const recentShown = recent.filter((e) => e !== here && e !== target && titles.has(e)).slice(0, 5);
    for (const eid of recentShown) {
      items.push({
        key: `recent:${eid}`,
        section: "Recent",
        label: titles.get(eid)!,
        when: "empty",
        run: () => void open(`/d/${projectId}/codex/${eid}`),
      });
    }
    let part = 0;
    let chapter = 0;
    for (const h of headings) {
      const label = h.text || "Untitled";
      let prefix: string | undefined;
      let keywords: string | undefined;
      if (!isEntry && h.level === 2) {
        prefix = `Part ${roman(++part)}`;
        keywords = `part ${part} ${prefix}`;
      } else if (!isEntry && h.level === 3) {
        prefix = String(++chapter).padStart(2, "0");
        keywords = `chapter ${chapter} ch ${chapter}`;
      }
      items.push({
        key: `h:${h.pos}`,
        section: isEntry ? "Headings" : "Contents",
        label,
        prefix,
        keywords,
        run: () => {
          const had = !!paletteFrom.current;
          jump(h);
          if (had && editor) requestAnimationFrame(() => editor.view.focus());
        },
      });
    }
    // The most recently viewed first, then the rest as listed.
    const byRecent = [...(lists.entries ?? [])].sort((a, b) => {
      const ra = recent.indexOf(a.id);
      const rb = recent.indexOf(b.id);
      return (ra < 0 ? Infinity : ra) - (rb < 0 ? Infinity : rb);
    });
    for (const e of byRecent) {
      if (e.id === here) continue;
      const shownAbove = recentShown.includes(e.id) || e.id === target;
      items.push({
        key: `codex:${e.id}`,
        section: "Codex",
        label: e.title,
        when: shownAbove ? "search" : undefined,
        run: () => void open(`/d/${projectId}/codex/${e.id}`),
      });
    }
    for (const b of lists.books ?? []) {
      if (b.id === projectId) continue;
      items.push({
        key: `book:${b.id}`,
        section: "Books",
        label: b.title,
        keywords: "book manuscript",
        run: () => void go(`/d/${b.id}`),
      });
    }
    return items;
  };

  /** What the command palette can do, given where the writer is and what they've selected. */
  const commands = (): PaletteItem[] => {
    const ed = paletteFrom.current ?? toolEditor;
    const picked = ed ? pickedWords(ed.state) : null;
    const theme: Theme = (document.documentElement.dataset.theme as Theme | undefined) ?? "auto";
    const nextTheme: Theme = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto";
    const items: (PaletteItem | false)[] = [
      {
        key: "go",
        section: "Go",
        label: "Go to…",
        keywords: "quick switcher open chapter entry book",
        hint: keys.key("goTo"),
        run: () => togglePalette("go"),
      },
      !!(isEntry || panelEntry || last) && {
        key: "switch",
        section: "Go",
        label: switchLabel,
        keywords: "switch codex manuscript",
        hint: keys.key("switch"),
        run: switchView,
      },
      // On an entry's page, the switch above is the way back.
      !isEntry && {
        key: "to-manuscript",
        section: "Go",
        label: "Go to the manuscript",
        keywords: "editor text write cursor",
        hint: keys.key("manuscript"),
        run: toManuscript,
      },
      !isEntry && {
        key: "to-codex",
        section: "Go",
        label: "Go to the Codex",
        keywords: `entry notes panel ${panelTitle ?? last?.title ?? ""}`,
        hint: keys.key("codex"),
        run: () => void toCodex(),
      },
      ai && {
        key: "to-construct",
        section: "Go",
        label: "Go to Construct",
        keywords: "open ai assistant chat panel ask",
        hint: keys.key("construct"),
        run: toConstruct,
      },
      { key: "library", section: "Go", label: "Library", keywords: "books shelves home", run: goLibrary },
      {
        key: "contents",
        section: "Go",
        label: "Show contents",
        keywords: "outline chapters drawer",
        run: () => showTab("contents"),
      },
      {
        key: "codex-list",
        section: "Go",
        label: "Show the Codex",
        keywords: "entries notes drawer",
        run: () => showTab("codex"),
      },

      !!(toolEditor && (!preview || inPanel)) && {
        key: "find",
        section: "Find",
        label: inPanel ? "Find in the entry…" : "Find…",
        keywords: "search look for",
        hint: keys.key("find"),
        run: () => openFind("find"),
      },
      !!(toolEditor && (!preview || inPanel)) && {
        key: "replace",
        section: "Find",
        label: inPanel ? "Find and replace in the entry…" : "Find and replace…",
        keywords: "search substitute change rename",
        hint: keys.key("replace"),
        run: () => openFind("replace"),
      },

      !!picked && {
        key: "lookup",
        section: "Selection",
        label: `Look up “${picked.text}”`,
        keywords: "dictionary define wordnet",
        hint: keys.key("lookUp"),
        refocus: true,
        run: () => requestLookUp(ed!),
      },
      ai && !!picked && {
        key: "ask-synonyms",
        section: "Selection",
        label: `Ask Construct for synonyms of “${picked.text}”`,
        keywords: "ai",
        run: () => askConstruct(ed!)(constructPrompt("synonyms", picked.text), picked, true, "synonyms"),
      },
      ai && !!picked && {
        key: "ask-meaning",
        section: "Selection",
        label: `Ask Construct what “${picked.text}” means`,
        keywords: "ai meaning",
        run: () => askConstruct(ed!)(constructPrompt("meaning", picked.text), picked, true, "meaning"),
      },
      ai && !!picked && {
        key: "ask",
        section: "Selection",
        label: `Ask Construct about “${picked.text}”…`,
        keywords: "ai question",
        run: () => askConstruct(ed!)(askDraft(picked.text), picked, false),
      },

      // Opening is "Go to Construct", above.
      constructOpen && {
        key: "construct",
        section: "Construct",
        label: "Close Construct",
        keywords: "ai assistant chat panel",
        run: closeConstruct,
      },
      ai && {
        key: "new-chat",
        section: "Construct",
        label: "New Construct chat",
        keywords: "ai assistant reset conversation",
        run: () => {
          if (!constructOpen) toggleConstruct();
          setNewChat((n) => n + 1);
        },
      },
      ai && {
        key: "compact-chat",
        section: "Construct",
        label: "Compact Construct’s conversation",
        keywords: "ai assistant context summarize memory",
        run: () => {
          if (!constructOpen) toggleConstruct();
          setCompactChat((n) => n + 1);
        },
      },

      {
        key: "grammar",
        section: "Grammar",
        label: grammarOn ? "Turn grammar check off" : "Turn grammar check on",
        keywords: "spelling harper toggle",
        refocus: true,
        run: toggleGrammar,
      },
      grammarOn && {
        key: "grammar-list",
        section: "Grammar",
        label: "Show grammar flags",
        keywords: "spelling list problems",
        run: () => showTab("grammar"),
      },

      !isEntry && {
        key: "save-version",
        section: "Versions",
        label: "Save version…",
        keywords: "snapshot history name checkpoint",
        refocus: true,
        ask: { placeholder: "Name this version (optional)", submit: (label) => void saveVersion(label) },
      },
      !isEntry && {
        key: "history",
        section: "Versions",
        label: "Show history",
        keywords: "versions snapshots restore",
        run: () => showTab("history"),
      },

      {
        key: "new-entry",
        section: "Codex",
        label: "New Codex entry",
        keywords: "note create character",
        run: () => void newEntry(),
      },
      !isEntry &&
        !!panelEntry && {
          key: "close-entry",
          section: "Codex",
          label: "Close the Codex panel",
          run: () => void closeEntry(),
        },
      !isEntry &&
        !!panelEntry && {
          key: "expand-entry",
          section: "Codex",
          label: `Open “${panelTitle || panelEntry}” on its own page`,
          keywords: "expand full",
          run: () => void go(`/d/${projectId}/codex/${panelEntry}`),
        },

      {
        key: "focus",
        section: "View",
        label: focusMode.focus ? "Leave focus mode" : "Focus mode",
        keywords: "distraction free zen",
        hint: keys.key("focus"),
        refocus: true,
        run: toggleFocus,
      },
      {
        key: "steady",
        section: "View",
        label: steady ? "Turn the typing fade on" : "Turn the typing fade off",
        keywords: "dim chrome top bar distraction steady",
        refocus: true,
        run: () => setSteady(!steady),
      },
      {
        key: "theme",
        section: "View",
        label: `Switch theme to ${THEME_LABEL[nextTheme]}`,
        keywords: "dark light night paper auto colors",
        refocus: true,
        run: cycleTheme,
      },
      {
        key: "pen-settings",
        section: "View",
        label: "Pen settings",
        keywords: "grammar dictionary dialect password lock",
        run: () => void go("/settings"),
      },

      {
        key: "export",
        section: "Book",
        label: "Export .md",
        keywords: "download markdown file",
        refocus: true,
        run: exportMarkdown,
      },
      {
        key: "settings",
        section: "Book",
        label: "Book settings",
        keywords: "cover shelf address rename delete",
        run: openSettings,
      },
    ];
    return items.filter((x): x is PaletteItem => !!x);
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
            onClick={() => togglePalette("go")}
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
            <button
              type="button"
              className="icon-btn"
              onClick={toggleFocus}
              aria-label="Focus mode"
              title={keys.title("Focus mode", "focus")}
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
            {ai && (
              <button
                type="button"
                className={`icon-btn construct-toggle ${constructOpen ? "is-on" : ""}`}
                onClick={toggleConstruct}
                aria-label="Construct"
                aria-expanded={constructOpen}
                title={keys.title("Construct", "construct")}
              >
                <IconConstruct />
              </button>
            )}
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
            onConstruct={ai ? toggleConstruct : undefined}
            onSettings={openSettings}
            onFind={() => openFind("find")}
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
        foot={<WordStats words={words} side="above" />}
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
            activeTitle={isEntry ? h1 || undefined : panelTitle}
            onOpen={open}
            refreshKey={codexKey}
            ai={ai}
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
        {findBar(editor)}
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
          onTitle={onPanelTitle}
          onChange={onPanelTyping}
        >
          {findBar(panelEditor)}
        </CodexPanel>
      )}

      {toolEditor && (!preview || inPanel) && (
        <Toolbar
          key={inPanel ? "panel" : "main"}
          editor={toolEditor}
          onAsk={ai ? askConstruct(toolEditor) : undefined}
          headingNames={inPanel ? HEADINGS.entry : headingNames}
        />
      )}

      {ai && (
        <Construct
          projectId={projectId}
          open={constructOpen}
          onClose={closeConstruct}
          getContext={constructContext}
          beforeSend={beforeConstruct}
          onCodexChange={onCodexChange}
          onOpen={open}
          onCite={cite}
          request={constructRequest}
          newChat={newChat}
          compact={compactChat}
          focus={constructFocus}
          onEscape={() => focusText(toolEditor)}
        />
      )}

      {palette && (
        <Palette key={palette} mode={palette} places={places()} commands={commands()} onClose={closePalette} />
      )}
      {notice && (
        <div className="toast" role="status" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

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
      {editor && (
        <GrammarPopover editor={editor} onAsk={ai ? (text, range) => askConstruct(editor)(text, range, true, "grammar") : undefined} />
      )}
      {panelEditor && (
        <GrammarPopover
          editor={panelEditor}
          onAsk={ai ? (text, range) => askConstruct(panelEditor)(text, range, true, "grammar") : undefined}
        />
      )}
      {editor && <WordTools editor={editor} onAsk={ai ? askConstruct(editor) : undefined} />}
      {panelEditor && <WordTools editor={panelEditor} onAsk={ai ? askConstruct(panelEditor) : undefined} />}
      {quick && !quick.editor.isDestroyed && (
        <QuickAnswer
          key={quick.id}
          projectId={projectId}
          quick={quick}
          onClose={closeQuick}
          onContinue={() => {
            setQuick(null);
            askChat(quick.editor, quick.prompt, quick, true);
          }}
        />
      )}
    </div>
  );
}
