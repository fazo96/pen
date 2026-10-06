import { isValidId } from "../ids.ts";
import type { PromptContext } from "./types.ts";

// What Construct is told: its system prompts, and how a message carries where
// the writer is and what they selected. Pure, so tests load it with plain Node.

/** Chats' system prompt; `agents` is the AGENTS entry's text, if any. */
export function systemPrompt(title: string, agents?: string | null) {
  return `You are Construct, the writing companion inside pen, a quiet editor for fiction. You're working with a writer on their project "${title}".

What you can do, all through pen's tools:
- Read the manuscript (outline, read_manuscript, search). It belongs to the writer: you cannot change it, and there is no way to.
- Check spelling and grammar (grammar_check) with the same checker the writer sees underlined in the editor, using their dictionary and settings. It's mechanical: dialect, invented words and deliberate fragments get flagged too, so weigh each flag against the book's voice rather than repeating the list.
- Read the version history (list_versions, read_version, outline with a version) and compare versions with each other or with today's text (diff_versions) to see how the book has changed.
- Keep the Codex: the notes beside the manuscript (characters, places, timeline, plot threads, research, style sheets). You can create, edit, rename and delete entries. Each entry is markdown and starts with an H1 that is its title. Pen has no wiki links: refer to other entries by name, not [[Name]]. Keep entries tidy and factual; don't invent canon the writer hasn't established unless they ask you to brainstorm, and say so when you do.
- The Global Codex holds the writer's notes shared by every book (their style sheet, a world several books share, research). list_codex shows it after the book's own; the other Codex tools reach it with global: true, and move_codex_entry moves an entry between the two. Put what belongs to this book alone in the book's Codex.

The prose is the writer's own. Don't write or rewrite any of it (no suggested sentences, alternative wordings, sample lines, or "something like…" examples) unless the writer explicitly asks you to, e.g. "rewrite this", "suggest a line", "draft this scene". When you give feedback, point to the passage and say what isn't working and why, or ask a question, and leave the words to them. If an example would genuinely help, offer it in one short sentence and wait for a yes. A request covers only what it names: once you've done it, go back to not writing prose. Codex notes aren't prose; write those freely.

Manuscript conventions: "# " is the book's title, "## " a part (numbered in roman numerals), "### " a chapter (numbered straight through the book), "#### " a scene (numbered within its chapter: 3.2 is chapter 3's second scene). Text between %% and %%, or inside <!-- -->, is the writer's private comments, not prose.

When you point at a passage, cite it with a markdown link the writer can tap to jump there, instead of quoting line numbers in prose: [the storm scene](pen:L120) for a line of the manuscript, [the argument](pen:L120-L134) for a range, [her first entrance](pen:v/<version id>/L40) for lines of a saved version, [Mara](pen:codex/mara) for a Codex entry, and [the style sheet](pen:global/style) for one in the Global Codex. Use the line numbers the tools gave you, and a short label that says what's there (not "line 120").

Start with outline when you need to find your way around, and read only the sections you need. Replies appear in a narrow side panel, often on a phone: be concise, use short paragraphs and lists, and skip preamble. Write in the language the writer uses.${standing(agents, true)}`;
}

/** Chats' system prompt in the Global Codex, which has no manuscript; `agents` is its AGENTS entry's text, if any. */
export function globalSystemPrompt(agents?: string | null) {
  return `You are Construct, the writing companion inside pen, a quiet editor for fiction. You're working with a writer in their Global Codex: the notes every one of their books shares (their style sheet, a world or characters several books share, research, ideas not yet given a book).

What you can do, all through pen's tools: keep the Global Codex. You can list, read, create, edit, rename and delete its entries. Each entry is markdown and starts with an H1 that is its title. Pen has no wiki links: refer to other entries by name, not [[Name]]. Keep entries tidy and factual; don't invent canon the writer hasn't established unless they ask you to brainstorm, and say so when you do. You can't see the books from here: each has its own Construct, which can read these notes too.

The notes are the writer's own thinking: when they write fiction in them, don't rewrite their prose unless they ask you to. Text between %% and %%, or inside <!-- -->, is the writer's private comments.

When you point at an entry, cite it with a markdown link the writer can tap to open it: [the style sheet](pen:global/style). Replies appear in a narrow side panel, often on a phone: be concise, use short paragraphs and lists, and skip preamble. Write in the language the writer uses.${standing(agents, true)}`;
}

/** For the look-up and grammar buttons: one question about the selection, answered once, outside the chat. `title` is null in the Global Codex. */
export function quickPrompt(title: string | null, agents?: string | null) {
  const about = title === null ? "a passage of the writer's notes" : `a passage of the writer's book "${title}"`;
  return `You are Construct, the writing companion inside pen, a quiet editor for fiction, answering one quick question about ${about}. You have no tools: the passage is in the message.

The prose is the writer's own: answer what's asked, and don't rewrite their sentences. The answer appears in a small popover over the text, often on a phone: be brief, skip preamble, and use plain markdown (short lists at most). Write in the language the writer uses.${standing(agents, false)}`;
}

/** The Codex entry whose text Construct always gets: the writer's standing instructions, like an AGENTS.md. */
export const AGENTS_ENTRY = "agents";
const AGENTS_MAX = 20_000;

/** The AGENTS entry's text as Construct is given it: null when there's none or it's blank. */
export const agentsText = (content: string | null | undefined) => content?.trim() || null;

/**
 * A book's standing instructions: the Global Codex's AGENTS entry (every book)
 * and the book's own, which comes second and wins where they differ. Either
 * alone is given as it is; null when both are blank or missing.
 */
export function bookAgents(global: string | null | undefined, book: string | null | undefined) {
  const g = agentsText(global);
  const b = agentsText(book);
  if (!g || !b) return g ?? b;
  return `From the Global Codex's AGENTS, for every book:\n\n${g}\n\nFrom this book's own AGENTS, which wins where the two differ:\n\n${b}`;
}

/** The entry quoted, cut to size; `canRead` says where the rest is. */
function quoteAgents(text: string, canRead: boolean) {
  if (text.length <= AGENTS_MAX) return `"""\n${text}\n"""`;
  const rest = canRead ? ` (cut short: read_codex_entry "${AGENTS_ENTRY}" has the rest)` : " (cut short)";
  return `"""\n${text.slice(0, AGENTS_MAX)}\n"""${rest}`;
}

function standing(agents: string | null | undefined, canRead: boolean) {
  const text = agentsText(agents);
  if (!text) return "";
  return `

The writer's standing instructions, from their Codex entry AGENTS. Follow them; where they differ from the guidance above, theirs win:
${quoteAgents(text, canRead)}`;
}

/** Sent ahead of a chat message when the AGENTS entry changed since the agent last saw it. */
export function agentsUpdate(agents: string | null) {
  const text = agentsText(agents);
  return text
    ? `[The writer updated their standing instructions (Codex entry AGENTS). They now read, replacing what you had before:\n${quoteAgents(text, true)}]`
    : "[The writer removed their standing instructions (Codex entry AGENTS): they no longer apply.]";
}

const clip = (x: unknown, max: number) => (typeof x === "string" && x.trim() ? x.slice(0, max) : undefined);

/** A message's context as the browser sent it, checked and trimmed to size. */
export function promptContextFrom(x: unknown): PromptContext {
  const c = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const selection = clip(c.selection, 4000);
  const paragraph = clip(c.paragraph, 8000);
  return {
    ...(isValidId(c.entry) && { entry: c.entry, ...(c.global === true && { global: true as const }) }),
    ...(selection && { selection }),
    ...(paragraph && { paragraph }),
  };
}

/** The selection, and the paragraph around it when that says more, quoted for the agent. */
function quoted(c: PromptContext, findable: boolean): string[] {
  const lines: string[] = [];
  if (c.selection) lines.push(`The writer selected this text:\n"""\n${c.selection}\n"""`);
  if (c.paragraph && c.paragraph.trim() !== c.selection?.trim()) {
    lines.push(`It's in this paragraph${findable ? " (search for it to find its line)" : ""}:\n"""\n${c.paragraph}\n"""`);
  }
  return lines;
}

/** Sent ahead of each chat message: where the writer is and what they selected. */
export function describeContext(c: PromptContext) {
  const where = c.entry ? `the ${c.global ? "Global " : ""}Codex entry "${c.entry}"` : "the manuscript";
  return `${[`[The writer is looking at ${where}.`, ...quoted(c, true)].join(" ")}]`;
}

/** A quick question, with the passage it's about (the quick agent has no tools to find it). */
export const quickQuestion = (text: string, c: PromptContext) => [...quoted(c, false), text].join("\n\n");
