import type { EditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

// Looking up a selected word, and asking Construct about it. The selection bar
// (desktop) and the toolbar (phones) offer the same actions.

export type Picked = { from: number; to: number; text: string; paragraph: string };

const MAX_WORDS = 4;
const MAX_CHARS = 64;

/** The selected word or short phrase, trimmed of spaces and punctuation at its edges; null if it's more than that. */
export function pickedWords(state: EditorState): Picked | null {
  const { from, to, empty, $from, $to } = state.selection;
  if (empty || !$from.sameParent($to) || !$from.parent.isTextblock) return null;
  if ($from.parent.type.name === "commentBlock" || $from.parent.type.name === "codeBlock") return null;
  const raw = state.doc.textBetween(from, to, " ", " ");
  const lead = raw.length - raw.replace(/^[\s\p{P}]+/u, "").length;
  const trail = raw.length - raw.replace(/[\s\p{P}]+$/u, "").length;
  // Keep a closing apostrophe that's part of the word ("walkers'" is rare; "it's" is common).
  const text = raw.slice(lead, raw.length - trail);
  if (!text || text.length > MAX_CHARS || !/\p{L}/u.test(text) || text.split(/\s+/).length > MAX_WORDS) return null;
  return { from: from + lead, to: to - trail, text, paragraph: $from.parent.textContent };
}

export type AskKind = "synonyms" | "meaning";

/** What each Construct button asks. */
export function constructPrompt(kind: AskKind, word: string): string {
  switch (kind) {
    case "synonyms":
      return `Suggest up to 8 alternatives for “${word}” that fit where it's used (its paragraph is attached) and the book's voice. One per line: the word or phrase first, then a few words on how it differs. No preamble.`;
    case "meaning":
      return `What does “${word}” mean as it's used here? Keep it short.`;
  }
}

export function grammarPrompt(problem: string, rule: string, message: string, fixes: string[]): string {
  const offered = fixes.length ? ` It suggests: ${fixes.map((f) => `“${f}”`).join(", ")}.` : "";
  return `The grammar checker flagged “${problem}” (${rule}): ${message}${offered} Is it actually wrong here, given the context and the book's voice? If so, how would you fix it? Keep it short.`;
}

/** The start of a question about the selection, left in Construct's input for the writer to finish. */
export const askDraft = (word: string) => `About “${word}”: `;

// The toolbar asks the editor's WordTools to open Look up.
type Listener = (editor: Editor) => void;
const lookUpListeners = new Set<Listener>();

export function requestLookUp(editor: Editor) {
  for (const fn of lookUpListeners) fn(editor);
}

export function onLookUpRequest(fn: Listener): () => void {
  lookUpListeners.add(fn);
  return () => lookUpListeners.delete(fn);
}
