// What the editor page's quick switcher and command palette list, given where
// the writer is. Pure: Pen.tsx gathers the page's state and actions into a
// context and renders what comes back; tests load it with plain Node.

import { roman, sceneNumber } from "./outline.ts";
import type { PaletteItem } from "./palette.ts";
import type { ShortcutId } from "./shortcuts.ts";
import type { DocMeta, EntryMeta } from "./types.ts";

type Heading = { pos: number; level: number; text: string };
type Entry = { id: string; title: string };
export type DrawerTab = "contents" | "codex" | "history" | "grammar";
export type AskKind = "synonyms" | "meaning" | "ask";

/** What both lists need to know. */
type Shared = {
  projectId: string;
  /** On a Codex entry's own page (else the manuscript's). */
  isEntry: boolean;
  /** The Codex entry shown: on its own page, or beside the manuscript. */
  here: string | null;
  /** The entry open beside the manuscript. */
  panelEntry: Entry | null;
  /** The entry viewed last, for the switch. */
  last: Entry | null;
  /** The switch's label: where Ctrl+Shift+E goes from here. */
  switchLabel: string;
  /** A shortcut's keys, as shown in hints. */
  hint: (id: ShortcutId) => string | undefined;
};

export type PlacesContext = Shared & {
  /** Codex entries by when they were viewed, the most recent first. */
  recent: string[];
  /** The Codex and the library, once fetched (null until then). */
  entries: EntryMeta[] | null;
  books: DocMeta[] | null;
  headings: Heading[];
  switchView: () => void;
  openEntry: (eid: string) => void;
  jumpTo: (h: Heading) => void;
  openBook: (id: string) => void;
};

/** Where the switcher can go: the switch, recent entries, headings, the Codex, other books. */
export function buildPlaces(c: PlacesContext): PaletteItem[] {
  const items: PaletteItem[] = [];
  const titles = new Map((c.entries ?? []).map((e) => [e.id, e.title]));
  if (c.isEntry || c.panelEntry || c.last) {
    // Searchable on an entry's page, where it's the way back; elsewhere it repeats an entry.
    items.push({
      key: "switch",
      section: "Recent",
      label: c.switchLabel,
      hint: c.hint("switch"),
      when: c.isEntry ? undefined : "empty",
      run: c.switchView,
    });
  }
  const target = !c.isEntry && !c.panelEntry ? c.last?.id : undefined;
  const recentShown = c.recent.filter((e) => e !== c.here && e !== target && titles.has(e)).slice(0, 5);
  for (const eid of recentShown) {
    items.push({ key: `recent:${eid}`, section: "Recent", label: titles.get(eid)!, when: "empty", run: () => c.openEntry(eid) });
  }
  let part = 0;
  let chapter = 0;
  let scene = 0;
  for (const h of c.headings) {
    let prefix: string | undefined;
    let keywords: string | undefined;
    if (!c.isEntry && h.level === 2) {
      prefix = `Part ${roman(++part)}`;
      keywords = `part ${part} ${prefix}`;
    } else if (!c.isEntry && h.level === 3) {
      prefix = String(++chapter).padStart(2, "0");
      keywords = `chapter ${chapter} ch ${chapter}`;
      scene = 0;
    } else if (!c.isEntry && h.level === 4) {
      prefix = sceneNumber(chapter, ++scene);
      keywords = `scene ${prefix}`;
    }
    items.push({
      key: `h:${h.pos}`,
      section: c.isEntry ? "Headings" : "Contents",
      label: h.text || "Untitled",
      prefix,
      keywords,
      run: () => c.jumpTo(h),
    });
  }
  // The most recently viewed first, then the rest as listed.
  const rankOf = new Map(c.recent.map((id, i) => [id, i]));
  const byRecent = [...(c.entries ?? [])].sort((a, b) => (rankOf.get(a.id) ?? Infinity) - (rankOf.get(b.id) ?? Infinity));
  for (const e of byRecent) {
    if (e.id === c.here) continue;
    const shownAbove = recentShown.includes(e.id) || e.id === target;
    items.push({
      key: `codex:${e.id}`,
      section: "Codex",
      label: e.title,
      when: shownAbove ? "search" : undefined,
      run: () => c.openEntry(e.id),
    });
  }
  for (const b of c.books ?? []) {
    if (b.id === c.projectId) continue;
    items.push({ key: `book:${b.id}`, section: "Books", label: b.title, keywords: "book manuscript", run: () => c.openBook(b.id) });
  }
  return items;
}

export type CommandsContext = Shared & {
  /** Pen's AI features are on. */
  ai: boolean;
  /** There's an editor to search (none while a version preview covers the manuscript). */
  canFind: boolean;
  /** The Codex panel's editor was used last. */
  inPanel: boolean;
  /** The words selected, when they can be looked up (up to four). */
  picked: string | null;
  constructOpen: boolean;
  grammarOn: boolean;
  focus: boolean;
  steady: boolean;
  /** What the theme button would switch to. */
  nextTheme: string;
  run: {
    goTo: () => void;
    switchView: () => void;
    toManuscript: () => void;
    toCodex: () => void;
    toConstruct: () => void;
    library: () => void;
    stats: () => void;
    showTab: (tab: DrawerTab) => void;
    find: (mode: "find" | "replace") => void;
    lookUp: () => void;
    ask: (kind: AskKind) => void;
    closeConstruct: () => void;
    newChat: () => void;
    compactChat: () => void;
    toggleGrammar: () => void;
    saveVersion: (label: string) => void;
    newEntry: () => void;
    closeEntry: () => void;
    expandEntry: () => void;
    toggleFocus: () => void;
    toggleSteady: () => void;
    cycleTheme: () => void;
    penSettings: () => void;
    exportMarkdown: () => void;
    bookSettings: () => void;
  };
};

/** What the command palette can do, given where the writer is and what they've selected. */
export function buildCommands(c: CommandsContext): PaletteItem[] {
  const { run, picked, isEntry, ai } = c;
  const entry = !isEntry ? c.panelEntry : null;
  const items: (PaletteItem | false | null)[] = [
    {
      key: "go",
      section: "Go",
      label: "Go to…",
      keywords: "quick switcher open chapter entry book",
      hint: c.hint("goTo"),
      run: run.goTo,
    },
    (isEntry || !!c.panelEntry || !!c.last) && {
      key: "switch",
      section: "Go",
      label: c.switchLabel,
      keywords: "switch codex manuscript",
      hint: c.hint("switch"),
      run: run.switchView,
    },
    // On an entry's page, the switch above is the way back.
    !isEntry && {
      key: "to-manuscript",
      section: "Go",
      label: "Go to the manuscript",
      keywords: "editor text write cursor",
      hint: c.hint("manuscript"),
      run: run.toManuscript,
    },
    !isEntry && {
      key: "to-codex",
      section: "Go",
      label: "Go to the Codex",
      keywords: `entry notes panel ${c.panelEntry?.title ?? c.last?.title ?? ""}`,
      hint: c.hint("codex"),
      run: run.toCodex,
    },
    ai && {
      key: "to-construct",
      section: "Go",
      label: "Go to Construct",
      keywords: "open ai assistant chat panel ask",
      hint: c.hint("construct"),
      run: run.toConstruct,
    },
    { key: "library", section: "Go", label: "Library", keywords: "books shelves home", run: run.library },
    { key: "stats", section: "Go", label: "Writing stats", keywords: "words today drafting editing progress", run: run.stats },
    { key: "contents", section: "Go", label: "Show contents", keywords: "outline chapters drawer", run: () => run.showTab("contents") },
    { key: "codex-list", section: "Go", label: "Show the Codex", keywords: "entries notes drawer", run: () => run.showTab("codex") },

    c.canFind && {
      key: "find",
      section: "Find",
      label: c.inPanel ? "Find in the entry…" : "Find…",
      keywords: "search look for",
      hint: c.hint("find"),
      run: () => run.find("find"),
    },
    c.canFind && {
      key: "replace",
      section: "Find",
      label: c.inPanel ? "Find and replace in the entry…" : "Find and replace…",
      keywords: "search substitute change rename",
      hint: c.hint("replace"),
      run: () => run.find("replace"),
    },

    picked !== null && {
      key: "lookup",
      section: "Selection",
      label: `Look up “${picked}”`,
      keywords: "dictionary define wordnet",
      hint: c.hint("lookUp"),
      refocus: true,
      run: run.lookUp,
    },
    ai &&
      picked !== null && {
        key: "ask-synonyms",
        section: "Selection",
        label: `Ask Construct for synonyms of “${picked}”`,
        keywords: "ai",
        run: () => run.ask("synonyms"),
      },
    ai &&
      picked !== null && {
        key: "ask-meaning",
        section: "Selection",
        label: `Ask Construct what “${picked}” means`,
        keywords: "ai meaning",
        run: () => run.ask("meaning"),
      },
    ai &&
      picked !== null && {
        key: "ask",
        section: "Selection",
        label: `Ask Construct about “${picked}”…`,
        keywords: "ai question",
        run: () => run.ask("ask"),
      },

    // Opening is "Go to Construct", above.
    c.constructOpen && {
      key: "construct",
      section: "Construct",
      label: "Close Construct",
      keywords: "ai assistant chat panel",
      run: run.closeConstruct,
    },
    ai && {
      key: "new-chat",
      section: "Construct",
      label: "New Construct chat",
      keywords: "ai assistant reset conversation",
      run: run.newChat,
    },
    ai && {
      key: "compact-chat",
      section: "Construct",
      label: "Compact Construct’s conversation",
      keywords: "ai assistant context summarize memory",
      run: run.compactChat,
    },

    {
      key: "grammar",
      section: "Grammar",
      label: c.grammarOn ? "Turn grammar check off" : "Turn grammar check on",
      keywords: "spelling harper toggle",
      refocus: true,
      run: run.toggleGrammar,
    },
    c.grammarOn && {
      key: "grammar-list",
      section: "Grammar",
      label: "Show grammar flags",
      keywords: "spelling list problems",
      run: () => run.showTab("grammar"),
    },

    !isEntry && {
      key: "save-version",
      section: "Versions",
      label: "Save version…",
      keywords: "snapshot history name checkpoint",
      refocus: true,
      ask: { placeholder: "Name this version (optional)", submit: run.saveVersion },
    },
    !isEntry && {
      key: "history",
      section: "Versions",
      label: "Show history",
      keywords: "versions snapshots restore",
      run: () => run.showTab("history"),
    },

    { key: "new-entry", section: "Codex", label: "New Codex entry", keywords: "note create character", run: run.newEntry },
    entry && { key: "close-entry", section: "Codex", label: "Close the Codex panel", run: run.closeEntry },
    entry && {
      key: "expand-entry",
      section: "Codex",
      label: `Open “${entry.title}” on its own page`,
      keywords: "expand full",
      run: run.expandEntry,
    },

    {
      key: "focus",
      section: "View",
      label: c.focus ? "Leave focus mode" : "Focus mode",
      keywords: "distraction free zen",
      hint: c.hint("focus"),
      refocus: true,
      run: run.toggleFocus,
    },
    {
      key: "steady",
      section: "View",
      label: c.steady ? "Turn the typing fade on" : "Turn the typing fade off",
      keywords: "dim chrome top bar distraction steady",
      refocus: true,
      run: run.toggleSteady,
    },
    {
      key: "theme",
      section: "View",
      label: `Switch theme to ${c.nextTheme}`,
      keywords: "dark light night paper auto colors",
      refocus: true,
      run: run.cycleTheme,
    },
    {
      key: "pen-settings",
      section: "View",
      label: "Pen settings",
      keywords: "grammar dictionary dialect password lock",
      run: run.penSettings,
    },

    { key: "export", section: "Book", label: "Export .md", keywords: "download markdown file", refocus: true, run: run.exportMarkdown },
    { key: "settings", section: "Book", label: "Book settings", keywords: "cover shelf address rename delete", run: run.bookSettings },
  ];
  return items.filter((x): x is PaletteItem => !!x);
}
