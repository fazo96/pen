import "server-only";
import { createEntry, listCodex, renameEntry, trashEntry, writeEntry } from "../../docs";
import { createdEntry } from "../transcript";
import { bool, checkSize, entry, entryIdProp, str, text, ToolError, tool } from "./core";

// The Codex, the writer's notes beside the manuscript: the only thing
// Construct can write.

export const codexTools = [
  tool({
    name: "list_codex",
    description: "The Codex: the writer's notes beside the manuscript (characters, places, plot, research), one markdown entry each.",
    properties: {},
    readOnly: true,
    run: async (_args, ctx) => {
      const list = (await listCodex(ctx.projectId)) ?? [];
      if (!list.length) return "The Codex is empty.";
      return list.map((e) => `${e.id}  "${e.title}"  ${e.words.toLocaleString("en")} words`).join("\n");
    },
  }),
  tool({
    name: "read_codex_entry",
    description: "Read a Codex entry's markdown, exactly as stored.",
    properties: { id: entryIdProp("Entry id from list_codex.") },
    required: ["id"],
    readOnly: true,
    run: async ({ id }, ctx) => (await entry(ctx.projectId, id)).content,
  }),
  tool({
    name: "create_codex_entry",
    description:
      "Create a Codex entry. Start the content with an H1 (# Name): it's the entry's title. The id is derived from the name and returned.",
    properties: {
      content: str("Markdown, starting with \"# Title\"."),
      name: str("Optional name to derive the id from (defaults to the H1)."),
    },
    required: ["content"],
    readOnly: false,
    run: async ({ content, name }, ctx) => {
      checkSize(content);
      const created = await createEntry(ctx.projectId, content, name);
      if (!created) throw new ToolError("The project is missing.");
      ctx.onCodexChange({ entry: created.id, action: "created" });
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
    },
    required: ["id", "old_text", "new_text"],
    readOnly: false,
    run: async ({ id: eid, old_text: oldText, new_text: newText, replace_all }, ctx) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await entry(ctx.projectId, eid);
        const count = current.content.split(oldText).length - 1;
        if (count === 0) throw new ToolError("old_text not found. Read the entry again: it may have changed.");
        if (count > 1 && !replace_all) {
          throw new ToolError(`old_text matches ${count} times. Add context to make it unique, or set replace_all.`);
        }
        const next = current.content.split(oldText).join(newText);
        checkSize(next);
        const result = await writeEntry(ctx.projectId, eid, next, current.version);
        if (result.ok) {
          ctx.onCodexChange({ entry: eid, action: "edited" });
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
    properties: { id: entryIdProp("Entry id."), content: str("The full new markdown, starting with \"# Title\".") },
    required: ["id", "content"],
    readOnly: false,
    run: async ({ id: eid, content }, ctx) => {
      checkSize(content);
      await entry(ctx.projectId, eid);
      await writeEntry(ctx.projectId, eid, content, null);
      ctx.onCodexChange({ entry: eid, action: "edited" });
      return `Wrote "${eid}".`;
    },
  }),
  tool({
    name: "rename_codex_entry",
    description: "Change a Codex entry's id (its file name). To change its title, edit the H1 instead.",
    properties: { id: entryIdProp("Current id."), new_id: entryIdProp("New id: lowercase letters, digits and dashes.") },
    required: ["id", "new_id"],
    readOnly: false,
    run: async ({ id: eid, new_id: to }, ctx) => {
      if (eid === to) return "Nothing to do.";
      await entry(ctx.projectId, eid);
      if (!(await renameEntry(ctx.projectId, eid, to))) throw new ToolError(`"${to}" is already taken.`);
      ctx.onCodexChange({ entry: eid, action: "renamed", to });
      return `Renamed "${eid}" to "${to}".`;
    },
  }),
  tool({
    name: "delete_codex_entry",
    description: "Delete a Codex entry (it goes to the trash, so the writer can recover it).",
    properties: { id: entryIdProp("Entry id.") },
    required: ["id"],
    readOnly: false,
    run: async ({ id: eid }, ctx) => {
      if (!(await trashEntry(ctx.projectId, eid))) throw new ToolError(`No Codex entry "${eid}".`);
      ctx.onCodexChange({ entry: eid, action: "deleted" });
      return `Deleted "${eid}".`;
    },
  }),
];
