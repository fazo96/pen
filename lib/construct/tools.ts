import "server-only";
import {
  createEntry,
  isValidId,
  listCodex,
  listVersions,
  MAX_BYTES,
  readDoc,
  readEntry,
  readVersion,
  renameEntry,
  trashEntry,
  writeEntry,
} from "../docs";
import { sectionsOf } from "../outline";
import { titleOf, wordCount } from "../text";

// Everything Construct can do, and nothing more. The agent's own file, shell
// and web tools are switched off; these are served to it over MCP (see
// ./mcp.ts). The manuscript and its versions are read-only by construction:
// there is no tool here that writes them.

export type CodexChange = { entry: string; action: "created" | "edited" | "renamed" | "deleted"; to?: string };

export type ToolContext = {
  projectId: string;
  /** Called after every change to the Codex, so open views can refresh. */
  onCodexChange: (change: CodexChange) => void;
};

type JsonSchema = { type: "object"; properties: Record<string, unknown>; required?: string[] };

type Tool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  readOnly: boolean;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
};

/** A failure the agent should see and can act on. */
class ToolError extends Error {}

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", minimum: 1, description });

function argString(args: Record<string, unknown>, key: string, optional: true): string | undefined;
function argString(args: Record<string, unknown>, key: string): string;
function argString(args: Record<string, unknown>, key: string, optional = false) {
  const v = args[key];
  if (v === undefined || v === null || v === "") {
    if (optional) return undefined;
    throw new ToolError(`Missing "${key}".`);
  }
  if (typeof v !== "string") throw new ToolError(`"${key}" must be a string.`);
  return v;
}

function argInt(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw new ToolError(`"${key}" must be a positive integer.`);
  return n;
}

async function manuscript(projectId: string) {
  const doc = await readDoc(projectId);
  if (!doc) throw new ToolError("The manuscript is missing.");
  return doc.content;
}

function entryId(args: Record<string, unknown>, key = "id") {
  const eid = argString(args, key);
  if (!isValidId(eid)) throw new ToolError(`"${eid}" is not a valid entry id (lowercase letters, digits and dashes).`);
  return eid;
}

async function entry(projectId: string, eid: string) {
  const e = await readEntry(projectId, eid);
  if (!e) throw new ToolError(`No Codex entry "${eid}". Use list_codex to see the ids.`);
  return e;
}

function checkSize(content: string) {
  if (Buffer.byteLength(content) > MAX_BYTES) throw new ToolError("Too large (max 5 MB).");
}

/** Find a heading by label ("Chapter 3", "Part II") or by (part of) its text. */
function findSection(markdown: string, query: string) {
  const sections = sectionsOf(markdown);
  const q = query.trim().toLowerCase();
  const exact = sections.find((s) => s.label.toLowerCase() === q || s.text.toLowerCase() === q);
  const match = exact ?? sections.find((s) => s.text.toLowerCase().includes(q));
  if (!match) throw new ToolError(`No heading matches "${query}". Use outline to see them.`);
  return match;
}

/** Lines of a document, numbered, optionally limited to a section or a range. */
function excerpt(markdown: string, args: Record<string, unknown>) {
  const lines = markdown.split("\n");
  const heading = argString(args, "heading", true);
  let from = argInt(args, "from_line") ?? 1;
  let to = argInt(args, "to_line") ?? lines.length;
  if (heading) {
    const s = findSection(markdown, heading);
    from = Math.max(from, s.line);
    to = Math.min(to, s.end);
  }
  to = Math.min(to, lines.length);
  if (from > to) return `(no lines: the document has ${lines.length})`;
  const width = String(to).length;
  const body = lines
    .slice(from - 1, to)
    .map((l, i) => `${String(from + i).padStart(width)}\t${l}`)
    .join("\n");
  return `Lines ${from}–${to} of ${lines.length}:\n${body}`;
}

function formatOutline(markdown: string) {
  const sections = sectionsOf(markdown);
  const total = wordCount(markdown);
  const chapters = sections.filter((s) => s.level === 3);
  const head = [
    `Title: ${titleOf(markdown, "Untitled")}`,
    `Words: ${total.toLocaleString("en")} · ${sections.filter((s) => s.level === 2).length} parts · ${chapters.length} chapters · ${markdown.split("\n").length} lines`,
  ];
  if (chapters.length) {
    const avg = Math.round(chapters.reduce((n, c) => n + c.words, 0) / chapters.length);
    head.push(`Average chapter: ${avg.toLocaleString("en")} words`);
  }
  const rows = sections.map((s) => {
    const indent = "  ".repeat(Math.max(0, s.level - 1));
    const name = s.label ? `${s.label}: ${s.text}` : s.text;
    return `${indent}${name}  (lines ${s.line}–${s.end}, ${s.words.toLocaleString("en")} words)`;
  });
  return [...head, "", ...(rows.length ? rows : ["(no headings yet)"])].join("\n");
}

const TOOLS: Tool[] = [
  // ─── Manuscript (read-only) ────────────────────────────────
  {
    name: "outline",
    description:
      "The manuscript's structure: title, parts and chapters with their line ranges and word counts, plus totals. Start here.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    run: async (_args, ctx) => formatOutline(await manuscript(ctx.projectId)),
  },
  {
    name: "read_manuscript",
    description:
      "Read the manuscript (markdown), with line numbers. Give a heading (\"Chapter 3\", \"Part II\", or part of a heading's text) to read one section, and/or a line range. Without either, returns the whole text.",
    inputSchema: {
      type: "object",
      properties: {
        heading: str("Section to read: a label like \"Chapter 3\" or \"Part II\", or text from the heading."),
        from_line: int("First line (1-based)."),
        to_line: int("Last line, inclusive."),
      },
    },
    readOnly: true,
    run: async (args, ctx) => excerpt(await manuscript(ctx.projectId), args),
  },
  {
    name: "search",
    description:
      "Find text in the manuscript and/or the Codex (case-insensitive). Returns matching lines with their line numbers and the chapter they're in.",
    inputSchema: {
      type: "object",
      properties: {
        query: str("Text to look for."),
        scope: { type: "string", enum: ["all", "manuscript", "codex"], description: "Where to look (default all)." },
      },
      required: ["query"],
    },
    readOnly: true,
    run: async (args, ctx) => {
      const query = argString(args, "query").toLowerCase();
      const scope = argString(args, "scope", true) ?? "all";
      const LIMIT = 80;
      const hits: string[] = [];
      const scan = (name: string, text: string, sections = sectionsOf(text)) => {
        text.split("\n").forEach((l, i) => {
          if (hits.length > LIMIT || !l.toLowerCase().includes(query)) return;
          const within = sections.filter((s) => s.line <= i + 1 && s.level > 1).pop();
          const where = within ? ` [${within.label || within.text}]` : "";
          hits.push(`${name}:${i + 1}${where}  ${l.length > 240 ? `${l.slice(0, 240)}…` : l}`);
        });
      };
      if (scope !== "codex") scan("manuscript", await manuscript(ctx.projectId));
      if (scope !== "manuscript") {
        for (const e of (await listCodex(ctx.projectId)) ?? []) {
          const doc = await readEntry(ctx.projectId, e.id);
          if (doc) scan(`codex/${e.id}`, doc.content, []);
        }
      }
      if (!hits.length) return "No matches.";
      return hits.length > LIMIT ? `${hits.slice(0, LIMIT).join("\n")}\n(more matches not shown; narrow the query)` : hits.join("\n");
    },
  },

  // ─── Version history (read-only) ───────────────────────────
  {
    name: "list_versions",
    description:
      "Saved versions of the manuscript, newest first: named ones the writer saved, and automatic ones (session starts, before restores).",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    run: async (_args, ctx) => {
      const list = await listVersions(ctx.projectId);
      if (!list.length) return "No saved versions yet.";
      return list
        .map((v) => `${v.id}  ${new Date(v.created).toISOString().slice(0, 16).replace("T", " ")}  ${v.kind}  ${v.words.toLocaleString("en")} words  ${v.label || "(unnamed)"}`)
        .join("\n");
    },
  },
  {
    name: "read_version",
    description: "Read a saved version of the manuscript, with line numbers. Same heading/line options as read_manuscript.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Version id from list_versions."),
        heading: str("Section to read."),
        from_line: int("First line (1-based)."),
        to_line: int("Last line, inclusive."),
      },
      required: ["id"],
    },
    readOnly: true,
    run: async (args, ctx) => {
      const content = await readVersion(ctx.projectId, argString(args, "id"));
      if (content === null) throw new ToolError("No such version. Use list_versions to see the ids.");
      return excerpt(content, args);
    },
  },

  // ─── Codex (read and write) ────────────────────────────────
  {
    name: "list_codex",
    description: "The Codex: the writer's notes beside the manuscript (characters, places, plot, research), one markdown entry each.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    run: async (_args, ctx) => {
      const list = (await listCodex(ctx.projectId)) ?? [];
      if (!list.length) return "The Codex is empty.";
      return list.map((e) => `${e.id}  "${e.title}"  ${e.words.toLocaleString("en")} words`).join("\n");
    },
  },
  {
    name: "read_codex_entry",
    description: "Read a Codex entry's markdown, exactly as stored.",
    inputSchema: { type: "object", properties: { id: str("Entry id from list_codex.") }, required: ["id"] },
    readOnly: true,
    run: async (args, ctx) => (await entry(ctx.projectId, entryId(args))).content,
  },
  {
    name: "create_codex_entry",
    description:
      "Create a Codex entry. Start the content with an H1 (# Name): it's the entry's title. The id is derived from the name and returned.",
    inputSchema: {
      type: "object",
      properties: {
        content: str("Markdown, starting with \"# Title\"."),
        name: str("Optional name to derive the id from (defaults to the H1)."),
      },
      required: ["content"],
    },
    readOnly: false,
    run: async (args, ctx) => {
      const content = argString(args, "content");
      checkSize(content);
      const created = await createEntry(ctx.projectId, content, argString(args, "name", true));
      if (!created) throw new ToolError("The project is missing.");
      ctx.onCodexChange({ entry: created.id, action: "created" });
      return `Created codex entry "${created.id}".`;
    },
  },
  {
    name: "edit_codex_entry",
    description:
      "Replace text in a Codex entry. old_text must match exactly once (include surrounding words if needed) unless replace_all is set. Prefer this over write_codex_entry for changes to part of an entry.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Entry id."),
        old_text: str("Exact text to replace."),
        new_text: { type: "string", description: "Replacement text (may be empty)." },
        replace_all: { type: "boolean", description: "Replace every occurrence." },
      },
      required: ["id", "old_text", "new_text"],
    },
    readOnly: false,
    run: async (args, ctx) => {
      const eid = entryId(args);
      const oldText = argString(args, "old_text");
      const newText = typeof args.new_text === "string" ? args.new_text : "";
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await entry(ctx.projectId, eid);
        const count = current.content.split(oldText).length - 1;
        if (count === 0) throw new ToolError("old_text not found. Read the entry again: it may have changed.");
        if (count > 1 && args.replace_all !== true) {
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
  },
  {
    name: "write_codex_entry",
    description: "Replace a Codex entry's whole content. Use for rewrites; for small changes use edit_codex_entry.",
    inputSchema: {
      type: "object",
      properties: { id: str("Entry id."), content: str("The full new markdown, starting with \"# Title\".") },
      required: ["id", "content"],
    },
    readOnly: false,
    run: async (args, ctx) => {
      const eid = entryId(args);
      const content = argString(args, "content");
      checkSize(content);
      await entry(ctx.projectId, eid);
      await writeEntry(ctx.projectId, eid, content, null);
      ctx.onCodexChange({ entry: eid, action: "edited" });
      return `Wrote "${eid}".`;
    },
  },
  {
    name: "rename_codex_entry",
    description: "Change a Codex entry's id (its file name). To change its title, edit the H1 instead.",
    inputSchema: {
      type: "object",
      properties: { id: str("Current id."), new_id: str("New id: lowercase letters, digits and dashes.") },
      required: ["id", "new_id"],
    },
    readOnly: false,
    run: async (args, ctx) => {
      const eid = entryId(args);
      const to = entryId(args, "new_id");
      if (eid === to) return "Nothing to do.";
      await entry(ctx.projectId, eid);
      if (!(await renameEntry(ctx.projectId, eid, to))) throw new ToolError(`"${to}" is already taken.`);
      ctx.onCodexChange({ entry: eid, action: "renamed", to });
      return `Renamed "${eid}" to "${to}".`;
    },
  },
  {
    name: "delete_codex_entry",
    description: "Delete a Codex entry (it goes to the trash, so the writer can recover it).",
    inputSchema: { type: "object", properties: { id: str("Entry id.") }, required: ["id"] },
    readOnly: false,
    run: async (args, ctx) => {
      const eid = entryId(args);
      if (!(await trashEntry(ctx.projectId, eid))) throw new ToolError(`No Codex entry "${eid}".`);
      ctx.onCodexChange({ entry: eid, action: "deleted" });
      return `Deleted "${eid}".`;
    },
  },
];

export function listTools() {
  return TOOLS.map(({ name, description, inputSchema, readOnly }) => ({
    name,
    description,
    inputSchema,
    annotations: { readOnlyHint: readOnly, destructiveHint: name === "delete_codex_entry" },
  }));
}

export type ToolResult = { text: string; isError: boolean };

export async function callTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { text: `Unknown tool "${name}".`, isError: true };
  const input = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  try {
    return { text: await tool.run(input, ctx), isError: false };
  } catch (err) {
    if (err instanceof ToolError) return { text: err.message, isError: true };
    console.error(`construct tool ${name} failed`, err);
    return { text: "Something went wrong on pen's side.", isError: true };
  }
}
