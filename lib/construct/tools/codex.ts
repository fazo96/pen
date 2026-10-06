import "server-only";
import { createEntry, GLOBAL, listCodex, moveEntry, renameEntry, trashEntry, writeEntry } from "../../docs";
import { createdEntry } from "../transcript";
import { bool, type CodexChange, checkSize, entry, entryIdProp, str, text, ToolError, type ToolContext, tool } from "./core";

// The Codex, the writer's notes beside the manuscript: the only thing
// Construct can write. In a book, `global` turns each tool to the Global
// Codex, the notes every book shares; the Global Codex's own chats get these
// tools without it (listTools strips it), and always work there.

const global = bool("Use the Global Codex (the notes every book shares) instead of this book's.");

/** Whose Codex a call is about. */
const ownerOf = (ctx: ToolContext, args: { global?: boolean }) => (args.global || ctx.projectId === GLOBAL ? GLOBAL : ctx.projectId);

/** Tell open views, saying which Codex changed. */
const changed = (ctx: ToolContext, owner: string, change: Omit<CodexChange, "global">) =>
  ctx.onCodexChange({ ...change, ...(owner === GLOBAL && { global: true }) });

const lines = (list: Awaited<ReturnType<typeof listCodex>>) =>
  (list ?? []).map((e) => `${e.id}  "${e.title}"  ${e.words.toLocaleString("en")} words`).join("\n");

export const codexTools = [
  tool({
    name: "list_codex",
    description:
      "The Codex: the writer's notes beside the manuscript (characters, places, plot, research), one markdown entry each; then the Global Codex, the notes every book shares.",
    properties: {},
    readOnly: true,
    run: async (_args, ctx) => {
      const shared = (await listCodex(GLOBAL)) ?? [];
      if (ctx.projectId === GLOBAL) return shared.length ? lines(shared) : "The Global Codex is empty.";
      const own = (await listCodex(ctx.projectId)) ?? [];
      return [
        own.length ? `This book's Codex:\n${lines(own)}` : "This book's Codex is empty.",
        shared.length ? `Global Codex (pass global: true to reach these):\n${lines(shared)}` : "The Global Codex is empty.",
      ].join("\n\n");
    },
  }),
  tool({
    name: "read_codex_entry",
    description: "Read a Codex entry's markdown, exactly as stored.",
    properties: { id: entryIdProp("Entry id from list_codex."), global },
    required: ["id"],
    readOnly: true,
    run: async (args, ctx) => (await entry(ownerOf(ctx, args), args.id)).content,
  }),
  tool({
    name: "create_codex_entry",
    description:
      "Create a Codex entry. Start the content with an H1 (# Name): it's the entry's title. The id is derived from the name and returned.",
    properties: {
      content: str("Markdown, starting with \"# Title\"."),
      name: str("Optional name to derive the id from (defaults to the H1)."),
      global,
    },
    required: ["content"],
    readOnly: false,
    run: async (args, ctx) => {
      const owner = ownerOf(ctx, args);
      checkSize(args.content);
      const created = await createEntry(owner, args.content, args.name);
      if (!created) throw new ToolError("The project is missing.");
      changed(ctx, owner, { entry: created.id, action: "created" });
      return createdEntry(created.id);
    },
  }),
  tool({
    name: "edit_codex_entry",
    description:
      "Replace text in a Codex entry. old_text must match exactly once (include surrounding words if needed) unless replace_all is set. Prefer this over write_codex_entry for changes to part of an entry.",
    properties: {
      id: entryIdProp("Entry id."),
      old_text: str("Exact text to replace."),
      new_text: text("Replacement text (may be empty)."),
      replace_all: bool("Replace every occurrence."),
      global,
    },
    required: ["id", "old_text", "new_text"],
    readOnly: false,
    run: async (args, ctx) => {
      const { id: eid, old_text: oldText, new_text: newText, replace_all } = args;
      const owner = ownerOf(ctx, args);
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await entry(owner, eid);
        const count = current.content.split(oldText).length - 1;
        if (count === 0) throw new ToolError("old_text not found. Read the entry again: it may have changed.");
        if (count > 1 && !replace_all) {
          throw new ToolError(`old_text matches ${count} times. Add context to make it unique, or set replace_all.`);
        }
        const next = current.content.split(oldText).join(newText);
        checkSize(next);
        const result = await writeEntry(owner, eid, next, current.version);
        if (result.ok) {
          changed(ctx, owner, { entry: eid, action: "edited" });
          return `Edited "${eid}" (${count} replacement${count > 1 ? "s" : ""}).`;
        }
        // Changed meanwhile (the writer typing): try again against the new text.
      }
      throw new ToolError("The entry keeps changing (the writer may be editing it). Try again shortly.");
    },
  }),
  tool({
    name: "write_codex_entry",
    description: "Replace a Codex entry's whole content. Use for rewrites; for small changes use edit_codex_entry.",
    properties: { id: entryIdProp("Entry id."), content: str("The full new markdown, starting with \"# Title\"."), global },
    required: ["id", "content"],
    readOnly: false,
    run: async (args, ctx) => {
      const owner = ownerOf(ctx, args);
      checkSize(args.content);
      await entry(owner, args.id);
      await writeEntry(owner, args.id, args.content, null);
      changed(ctx, owner, { entry: args.id, action: "edited" });
      return `Wrote "${args.id}".`;
    },
  }),
  tool({
    name: "rename_codex_entry",
    description: "Change a Codex entry's id (its file name). To change its title, edit the H1 instead.",
    properties: { id: entryIdProp("Current id."), new_id: entryIdProp("New id: lowercase letters, digits and dashes."), global },
    required: ["id", "new_id"],
    readOnly: false,
    run: async (args, ctx) => {
      const { id: eid, new_id: to } = args;
      const owner = ownerOf(ctx, args);
      if (eid === to) return "Nothing to do.";
      await entry(owner, eid);
      if (!(await renameEntry(owner, eid, to))) throw new ToolError(`"${to}" is already taken.`);
      changed(ctx, owner, { entry: eid, action: "renamed", to });
      return `Renamed "${eid}" to "${to}".`;
    },
  }),
  tool({
    name: "delete_codex_entry",
    description: "Delete a Codex entry (it goes to the trash, so the writer can recover it).",
    properties: { id: entryIdProp("Entry id."), global },
    required: ["id"],
    readOnly: false,
    run: async (args, ctx) => {
      const owner = ownerOf(ctx, args);
      if (!(await trashEntry(owner, args.id))) throw new ToolError(`No Codex entry "${args.id}".`);
      changed(ctx, owner, { entry: args.id, action: "deleted" });
      return `Deleted "${args.id}".`;
    },
  }),
];

/** A book's Construct only: the Global Codex's own chats have no book to move an entry into. */
export const moveTool = tool({
  name: "move_codex_entry",
  description:
    "Move an entry from this book's Codex to the Global Codex, so every book shares it; with global: true, from the Global Codex into this book's. Its id stays unless taken there; the new id is returned.",
  properties: {
    id: entryIdProp("Entry id, where it is now."),
    global: bool("The entry is in the Global Codex now, and moves into this book's."),
  },
  required: ["id"],
  readOnly: false,
  run: async (args, ctx) => {
    if (ctx.projectId === GLOBAL) throw new ToolError("There's no book here to move it into.");
    const from = ownerOf(ctx, args);
    const to = from === GLOBAL ? ctx.projectId : GLOBAL;
    await entry(from, args.id);
    const moved = await moveEntry(from, args.id, to);
    if (!moved) throw new ToolError(`Couldn't move "${args.id}".`);
    changed(ctx, from, { entry: args.id, action: "moved", to: moved });
    return `Moved "${args.id}" to ${to === GLOBAL ? "the Global Codex" : "this book's Codex"}${moved === args.id ? "" : ` as "${moved}" (its id was taken there)`}.`;
  },
});
