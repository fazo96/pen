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

/** The kinds of quick question the buttons ask, answered in a popover (components/QuickAnswer.tsx). */
export type QuickKind = AskKind | "grammar";

/**
 * The words offered in a Synonyms answer ("One per line: the word or phrase
 * first, then a few words on how it differs"), to make them clickable:
 * list markers, emphasis and quotes dropped, the explanation cut off.
 */
export function alternativesIn(answer: string): string[] {
  const out: string[] = [];
  for (const raw of answer.split("\n")) {
    let line = raw.trim().replace(/^(?:[-*•+]|\d+[.)])\s+/, "");
    if (!line) continue;
    const bold = line.match(/^\*\*(.+?)\*\*|^__(.+?)__/);
    if (bold) line = bold[1] ?? bold[2];
    else line = line.split(/\s+[—–-]\s+|:\s|\s\(|,\s/)[0];
    const word = line.replace(/^[*_"“‘'`]+|[*_"”’'`.,;:!?]+$/g, "").trim();
    if (word && word.length <= 40 && word.split(/\s+/).length <= 4 && /\p{L}/u.test(word) && !out.includes(word)) out.push(word);
  }
  return out;
}

/** `word` with the case of the text it replaces: "Stroll" for "Walk", "STROLL" for "WALK". */
export function matchCase(word: string, like: string): string {
  if (like.length > 1 && like === like.toUpperCase() && like !== like.toLowerCase()) return word.toUpperCase();
  if (like[0] && like[0] === like[0].toUpperCase() && like[0] !== like[0].toLowerCase()) return word[0].toUpperCase() + word.slice(1);
  return word;
}
