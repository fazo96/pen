// Keyboard shortcuts, written once for tooltips, the command palette and the list in /settings:
// pure, so tests load it with plain Node.

type Shortcut = { keys: string; what: string; group: "Go" | "Write" | "Format" };

/** "Mod" is Ctrl, or ⌘ on a Mac. Most are handled in `Pen.tsx`; the formatting ones are Tiptap's own. */
export const SHORTCUTS = {
  goTo: { keys: "Mod+O", what: "Go to… (chapters, Codex, books)", group: "Go" },
  commands: { keys: "Mod+K", what: "Commands", group: "Go" },
  commandsAlt: { keys: "Mod+P", what: "Commands", group: "Go" },
  switch: { keys: "Mod+Shift+E", what: "Manuscript ⇄ the last Codex entry", group: "Go" },
  manuscript: { keys: "Mod+Shift+M", what: "Go to the manuscript", group: "Go" },
  codex: { keys: "Mod+Shift+X", what: "Go to the Codex entry", group: "Go" },
  construct: { keys: "Mod+Shift+A", what: "Go to Construct", group: "Go" },
  focus: { keys: "Mod+Shift+F", what: "Focus mode", group: "Write" },
  lookUp: { keys: "Mod+Shift+D", what: "Look up the selected words", group: "Write" },
  undo: { keys: "Mod+Z", what: "Undo", group: "Write" },
  redo: { keys: "Mod+Shift+Z", what: "Redo", group: "Write" },
  h1: { keys: "Mod+Alt+1", what: "Heading 1 (the title)", group: "Format" },
  h2: { keys: "Mod+Alt+2", what: "Heading 2 (a part)", group: "Format" },
  h3: { keys: "Mod+Alt+3", what: "Heading 3 (a chapter)", group: "Format" },
  bold: { keys: "Mod+B", what: "Bold", group: "Format" },
  italic: { keys: "Mod+I", what: "Italic", group: "Format" },
  strike: { keys: "Mod+Shift+S", what: "Strikethrough", group: "Format" },
  quote: { keys: "Mod+Shift+B", what: "Quote", group: "Format" },
  bullets: { keys: "Mod+Shift+8", what: "Bulleted list", group: "Format" },
  numbers: { keys: "Mod+Shift+7", what: "Numbered list", group: "Format" },
} as const satisfies Record<string, Shortcut>;

export type ShortcutId = keyof typeof SHORTCUTS;

const MAC: Record<string, string> = { Mod: "⌘", Alt: "⌥", Shift: "⇧", Ctrl: "⌃" };
// Apple's order: ⌃⌥⇧⌘, then the key.
const MAC_ORDER = ["Ctrl", "Alt", "Shift", "Mod"];

/** "Ctrl+Shift+E", or "⇧⌘E" on a Mac. */
export function keyLabel(id: ShortcutId, mac: boolean): string {
  const parts = SHORTCUTS[id].keys.split("+");
  const key = parts.pop()!;
  if (!mac) return [...parts.map((p) => (p === "Mod" ? "Ctrl" : p)), key].join("+");
  return MAC_ORDER.filter((m) => parts.includes(m)).map((m) => MAC[m]).join("") + key;
}

/** A tooltip: "Bold (Ctrl+B)". */
export const withKeys = (label: string, id: ShortcutId, mac: boolean) => `${label} (${keyLabel(id, mac)})`;

/** Every shortcut by group, those doing the same thing on one row (Ctrl+K, Ctrl+P), for the list in /settings. */
export function shortcutList(mac: boolean): { group: string; rows: { what: string; keys: string[] }[] }[] {
  const groups: { group: string; rows: { what: string; keys: string[] }[] }[] = [];
  for (const id of Object.keys(SHORTCUTS) as ShortcutId[]) {
    const { what, group } = SHORTCUTS[id];
    let g = groups.find((x) => x.group === group);
    if (!g) groups.push((g = { group, rows: [] }));
    const row = g.rows.find((r) => r.what === what);
    if (row) row.keys.push(keyLabel(id, mac));
    else g.rows.push({ what, keys: [keyLabel(id, mac)] });
  }
  return groups;
}

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
