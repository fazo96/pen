import "server-only";
import { readDoc, writeDoc } from "../../docs";
import { EDIT_MODE_NAMES, type EditMode } from "../editMode";
import { getEditMode } from "../settings";
import { bool, checkSize, int, str, text, ToolError, type ToolContext, tool } from "./core";

// Changing the manuscript, as far as the writer lets Construct (their book's
// mode, ../editMode.ts, read at every call so a change in the panel holds at
// once): its comments in "comments", anything in "full". The tools are always
// listed in a book's chats (pi fixes its tool list at launch) and refuse when
// the mode doesn't allow them. A comment tool must leave the prose exactly as
// it was (proseOf), whatever the mode. Each write is checked against the
// version it read, like the writer's saves, and doesn't count in their stats.

/** What each tool needs the mode to be, at least. */
const NEEDS: Record<"comments" | "full", EditMode[]> = { comments: ["comments", "full"], full: ["full"] };

async function allowed(ctx: ToolContext, need: "comments" | "full") {
  const mode = await getEditMode(ctx.projectId);
  if (NEEDS[need].includes(mode)) return;
  throw new ToolError(
    mode === "off"
      ? "The writer hasn't let Construct change the manuscript (its Manuscript setting is Off). Point to the passage instead; they can turn editing on in the Construct panel."
      : `The writer only lets Construct change the manuscript's comments (Manuscript: ${EDIT_MODE_NAMES[mode]}). Use add_comment, edit_comment or remove_comment, or point to the passage.`,
  );
}

const COMMENT_RE = /%%([\s\S]*?)%%|<!--([\s\S]*?)-->/g;
/** A comment with the spaces before it: "the boats %% … %%." is "the boats." */
const STRIP_RE = /[ \t]*(?:%%[\s\S]*?%%|<!--[\s\S]*?-->)/g;

/** The prose, without comments: its paragraphs, whitespace collapsed. A comment tool must leave it as it was. */
function proseOf(markdown: string) {
  return markdown
    .replace(STRIP_RE, "")
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const sameProse = (a: string, b: string) => {
  const x = proseOf(a);
  const y = proseOf(b);
  return x.length === y.length && x.every((p, i) => p === y[i]);
};

/**
 * Change the manuscript with `apply` (given its text, returning the new text
 * and what to tell the agent), written over the version it read; retried if
 * the writer saved meanwhile. `commentsOnly`: refused if the prose changed.
 */
async function change(ctx: ToolContext, need: "comments" | "full", commentsOnly: boolean, apply: (markdown: string) => { content: string; done: string }) {
  await allowed(ctx, need);
  for (let attempt = 0; attempt < 3; attempt++) {
    const doc = await readDoc(ctx.projectId);
    if (!doc) throw new ToolError("The manuscript is missing.");
    const { content, done } = apply(doc.content);
    if (content === doc.content) return "Nothing changed.";
    if (commentsOnly && !sameProse(doc.content, content)) {
      throw new ToolError("That would change the prose, not only a comment, so nothing was written. Read the line again and place the comment differently.");
    }
    checkSize(content);
    await ctx.beforeManuscriptEdit();
    const result = await writeDoc(ctx.projectId, content, doc.version);
    if (result.ok) {
      ctx.onManuscriptChange();
      return done;
    }
    // The writer saved meanwhile: try again against their text.
  }
  throw new ToolError("The manuscript keeps changing (the writer may be typing). Try again shortly.");
}

function lineOf(lines: string[], n: number) {
  if (n > lines.length) throw new ToolError(`There's no line ${n}: the manuscript has ${lines.length}.`);
  return lines[n - 1];
}

/** Lines `n` and `n + 1` are one paragraph or list: nothing can go between them as a block. */
function runsOn(lines: string[], n: number, what: string) {
  if (!lineOf(lines, n).trim()) throw new ToolError(`Line ${n} is blank: give the last line of the paragraph to put the ${what} after.`);
  if (lines[n]?.trim()) {
    throw new ToolError(`Line ${n} runs on into line ${n + 1} (the same paragraph or list): put the ${what} after its last line${what === "comment" ? ", or inline with after" : ""}.`);
  }
}

/** A comment's text, on one line, without anything that would end it early. */
function noteOf(raw: string) {
  const note = raw.replace(/\s+/g, " ").trim();
  if (!note) throw new ToolError("The comment is empty.");
  if (/%%|<!--|-->/.test(note)) throw new ToolError("A comment can't contain %%, <!-- or -->.");
  return note;
}

type Found = { start: number; end: number; open: string; close: string; inner: string; block: boolean; lineStart: number; lineEnd: number };

/** The comments on line `n` (or running through it). `block`: alone on its lines. */
function commentsOn(markdown: string, n: number): Found[] {
  const lines = markdown.split("\n");
  lineOf(lines, n);
  const from = lines.slice(0, n - 1).reduce((sum, l) => sum + l.length + 1, 0);
  const to = from + lines[n - 1].length;
  const out: Found[] = [];
  for (const m of markdown.matchAll(COMMENT_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    if (start > to) break;
    if (end <= from) continue;
    const lineStart = markdown.lastIndexOf("\n", start - 1) + 1;
    const next = markdown.indexOf("\n", end);
    const lineEnd = next < 0 ? markdown.length : next;
    const block = /^ {0,3}$/.test(markdown.slice(lineStart, start)) && /^[ \t]*$/.test(markdown.slice(end, lineEnd));
    const percent = m[1] !== undefined;
    out.push({ start, end, open: percent ? "%%" : "<!--", close: percent ? "%%" : "-->", inner: m[1] ?? m[2], block, lineStart, lineEnd });
  }
  return out;
}

/** The one comment on line `n` that has `words` in it (or the only one there). */
function pick(markdown: string, n: number, words: string | undefined) {
  const all = commentsOn(markdown, n);
  if (!all.length) throw new ToolError(`Line ${n} has no comment (they read as %% … %% or <!-- … -->).`);
  const hits = words ? all.filter((c) => c.inner.toLowerCase().includes(words.toLowerCase())) : all;
  if (!hits.length) throw new ToolError(`No comment on line ${n} has "${words}" in it.`);
  if (hits.length > 1) throw new ToolError(`Line ${n} has ${hits.length} comments${words ? ` with "${words}"` : ""}: give words from the one you mean.`);
  return hits[0];
}

const line = int("The line, as read_manuscript numbers it.");
const which = str("Words from the comment, when the line has more than one.");

export const editTools = [
  tool({
    name: "add_comment",
    description:
      "Add a comment to the manuscript: a %% … %% note for the writer, which isn't prose. With after (words found once on the line), it goes inline right after them; without, on its own line after this one (the last line of a paragraph). Needs the writer's Manuscript setting to be Only comments or Full.",
    properties: {
      line,
      text: str("The comment, one line."),
      after: str("Words on that line to put the comment right after, inline."),
    },
    required: ["line", "text"],
    readOnly: false,
    run: async (args, ctx) => {
      const note = noteOf(args.text);
      return change(ctx, "comments", true, (markdown) => {
        const lines = markdown.split("\n");
        const n = args.line;
        if (args.after) {
          const l = lineOf(lines, n);
          const at = l.indexOf(args.after);
          if (at < 0) throw new ToolError(`"${args.after}" isn't on line ${n}.`);
          if (l.indexOf(args.after, at + 1) >= 0) throw new ToolError(`"${args.after}" is on line ${n} more than once: give more words.`);
          const cut = at + args.after.length;
          lines[n - 1] = `${l.slice(0, cut)} %% ${note} %%${l.slice(cut)}`;
          return { content: lines.join("\n"), done: `Added a comment on line ${n}.` };
        }
        runsOn(lines, n, "comment");
        lines.splice(n, 0, "", `%% ${note} %%`);
        return { content: lines.join("\n"), done: `Added a comment after line ${n}, as line ${n + 2}.` };
      });
    },
  }),
  tool({
    name: "edit_comment",
    description: "Change the text of a comment in the manuscript, found by its line. Needs the writer's Manuscript setting to be Only comments or Full.",
    properties: { line, comment: which, text: str("Its new text, one line.") },
    required: ["line", "text"],
    readOnly: false,
    run: async (args, ctx) => {
      const note = noteOf(args.text);
      return change(ctx, "comments", true, (markdown) => {
        const c = pick(markdown, args.line, args.comment);
        // The writer's padding stays as it was ("<!--note-->", "%%\nnote\n%%").
        const [, lead, , trail] = c.inner.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
        const content = `${markdown.slice(0, c.start)}${c.open}${lead}${note}${trail}${c.close}${markdown.slice(c.end)}`;
        return { content, done: `Edited the comment on line ${args.line}.` };
      });
    },
  }),
  tool({
    name: "remove_comment",
    description: "Remove a comment from the manuscript, found by its line. Needs the writer's Manuscript setting to be Only comments or Full.",
    properties: { line, comment: which },
    required: ["line"],
    readOnly: false,
    run: async (args, ctx) =>
      change(ctx, "comments", true, (markdown) => {
        const c = pick(markdown, args.line, args.comment);
        let content: string;
        if (c.block) {
          // Its lines go, and the blank line that would be left doubled.
          const before = markdown.slice(0, c.lineStart);
          let after = markdown.slice(c.lineEnd + 1);
          if ((before === "" || before.endsWith("\n\n")) && /^[ \t]*(\n|$)/.test(after)) after = after.replace(/^[ \t]*\n?/, "");
          content = after ? before + after : before.replace(/\n+$/, "\n");
        } else {
          const space = markdown[c.start - 1] === " " ? 1 : 0;
          content = markdown.slice(0, c.start - space) + markdown.slice(c.end + (space ? 0 : markdown[c.end] === " " ? 1 : 0));
        }
        return { content, done: `Removed the comment on line ${args.line}.` };
      }),
  }),
  tool({
    name: "edit_manuscript",
    description:
      "Replace text in the manuscript (markdown, without read_manuscript's line numbers). old_text must match exactly once (include surrounding words if needed) unless replace_all is set. Only with the writer's Manuscript setting on Full, and only for changes they asked for.",
    properties: {
      old_text: str("Exact text to replace."),
      new_text: text("Replacement text (may be empty)."),
      replace_all: bool("Replace every occurrence."),
    },
    required: ["old_text", "new_text"],
    readOnly: false,
    run: async (args, ctx) =>
      change(ctx, "full", false, (markdown) => {
        const count = markdown.split(args.old_text).length - 1;
        if (count === 0) throw new ToolError("old_text not found. Read the passage again: it may have changed.");
        if (count > 1 && !args.replace_all) throw new ToolError(`old_text matches ${count} times. Add context to make it unique, or set replace_all.`);
        return { content: markdown.split(args.old_text).join(args.new_text), done: `Edited the manuscript (${count} replacement${count > 1 ? "s" : ""}).` };
      }),
  }),
  tool({
    name: "insert_manuscript",
    description:
      "Insert a passage into the manuscript as paragraphs of its own (markdown: paragraphs, headings, scenes), after a line that ends a paragraph. Only with the writer's Manuscript setting on Full, and only for passages they asked for.",
    properties: { after_line: int("The line to insert after, as read_manuscript numbers it: the last line of a paragraph."), text: str("The passage, in markdown.") },
    required: ["after_line", "text"],
    readOnly: false,
    run: async (args, ctx) => {
      const passage = args.text.replace(/\r\n?/g, "\n").replace(/^\s*\n|\n\s*$/g, "");
      if (!passage.trim()) throw new ToolError("The passage is empty.");
      return change(ctx, "full", false, (markdown) => {
        const lines = markdown.split("\n");
        const n = args.after_line;
        runsOn(lines, n, "passage");
        const added = passage.split("\n");
        lines.splice(n, 0, "", ...added);
        return { content: lines.join("\n"), done: `Inserted ${added.length} line${added.length > 1 ? "s" : ""} after line ${n} (now lines ${n + 2}–${n + 1 + added.length}).` };
      });
    },
  }),
];
