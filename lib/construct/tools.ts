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
import { ruleLabel } from "../grammarConfig";
import { type Section, sectionsOf } from "../outline";
import { straightQuotes, titleOf, wordCount } from "../text";
import { alignBlocks, blockKey, countWords, wordDiff } from "../textdiff";
import { checkGrammar, type GrammarReport } from "./grammarCheck";
import { createdEntry } from "./transcript";

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

const GRAMMAR_LIMIT = 150;
const SPELLING_KINDS = new Set(["Spelling", "Typo"]);

/** grammar_check's answer: flags one per line, citable, with what Harper suggests. */
function formatGrammar(report: GrammarReport, where: string, kind: string, citable: boolean) {
  const all = report.flags.filter(
    (f) => kind === "all" || SPELLING_KINDS.has(f.flag.kind) === (kind === "spelling"),
  );
  if (!report.checked) return `Nothing to check in ${where}.`;
  const spelling = all.filter((f) => SPELLING_KINDS.has(f.flag.kind)).length;
  const head = [
    all.length
      ? `${all.length} flagged in ${where} (${report.checked} paragraphs checked): ${spelling} spelling, ${all.length - spelling} grammar and style.`
      : `Nothing flagged in ${where} (${report.checked} paragraphs checked).`,
  ];
  if (kind !== "grammar" && report.words.length) {
    head.push(
      `Unknown words met more than once (often names; the writer can add them to the dictionary): ${report.words
        .slice(0, 30)
        .map((w) => `${w.word} ×${w.count}`)
        .join(", ")}`,
    );
  }
  const rows = all.slice(0, GRAMMAR_LIMIT).map(({ line, flag }) => {
    const fixes = flag.suggestions
      .slice(0, 3)
      .map((s) => (s.kind === "remove" ? "remove it" : s.kind === "insert" ? `add “${s.text}”` : `“${s.text}”`));
    const what = flag.rule === "SpellCheck" ? "Spelling" : ruleLabel(flag.rule);
    const at = citable ? `pen:L${line}` : `line ${line}`;
    return `${at} “${flag.problem}” — ${what}: ${flag.message.replace(/`([^`]*)`/g, "“$1”")}${fixes.length ? ` → ${fixes.join(", ")}` : ""}`;
  });
  if (all.length > GRAMMAR_LIMIT) {
    const rest = new Map<string, number>();
    for (const { flag } of all.slice(GRAMMAR_LIMIT)) {
      const what = flag.rule === "SpellCheck" ? "Spelling" : ruleLabel(flag.rule);
      rest.set(what, (rest.get(what) ?? 0) + 1);
    }
    rows.push(
      `(${all.length - GRAMMAR_LIMIT} more not shown: ${[...rest].map(([k, n]) => `${k} ${n}`).join(", ")}. Narrow it with heading or lines.)`,
    );
  }
  return [...head, "", ...rows].join("\n");
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

// ─── Comparing versions ──────────────────────────────────────

const stamp = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

async function versionText(projectId: string, vid: string) {
  const content = await readVersion(projectId, vid);
  if (content === null) throw new ToolError(`No version "${vid}". Use list_versions to see the ids.`);
  return content;
}

async function versionName(projectId: string, vid: string) {
  const meta = (await listVersions(projectId)).find((v) => v.id === vid);
  return meta ? `version ${vid} ("${meta.label || "unnamed"}", ${stamp(meta.created)})` : `version ${vid}`;
}

/** Keeps spaces outside the markers: "a [-b-] c", not "a[- b -]c". */
function mark(value: string, open: string, close: string) {
  const [, lead, core, trail] = value.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  return `${lead}${open}${core}${close}${trail}`;
}

const clip = (s: string, max = 400) => (s.length > max ? `${s.slice(0, max).trimEnd()}…` : s);

/** An edited paragraph with [-removed-]{+added+} words; long unchanged stretches shortened to "…". */
function markWords(before: string, after: string) {
  const KEEP = 50;
  const parts = wordDiff(before, after);
  return parts
    .map((p, i) => {
      if (p.removed) return mark(p.value, "[-", "-]");
      if (p.added) return mark(p.value, "{+", "+}");
      const v = p.value;
      if (v.length <= KEEP * 2 + 10) return v;
      if (i === 0) return `…${v.slice(-KEEP)}`;
      if (i === parts.length - 1) return `${v.slice(0, KEEP)}…`;
      return `${v.slice(0, KEEP)} … ${v.slice(-KEEP)}`;
    })
    .join("");
}

type Line = { line: number; text: string; key: string };

/** Non-blank lines of `markdown` (quotes straightened), optionally only one section's. */
function linesOf(markdown: string, section?: { line: number; end: number } | null): Line[] {
  const out: Line[] = [];
  markdown.split("\n").forEach((l, i) => {
    const line = i + 1;
    if (section && (line < section.line || line > section.end)) return;
    const text = straightQuotes(l);
    const key = blockKey(text);
    if (key) out.push({ line, text, key });
  });
  return out;
}

const MAX_DIFF_CHARS = 40_000;

function diffMarkdown(before: string, after: string, heading: string | undefined, header: string[]) {
  let secA: Section | null | undefined;
  let secB: Section | null | undefined;
  if (heading) {
    const find = (md: string) => {
      try {
        return findSection(md, heading);
      } catch {
        return null;
      }
    };
    secA = find(before);
    secB = find(after);
    if (!secA && !secB) throw new ToolError(`No heading matches "${heading}" in either text. Use outline to see them.`);
    header.push(`Section: ${[secA, secB].map((s) => (s ? `${s.label ? `${s.label}: ` : ""}${s.text}` : "(missing)")).join(" → ")}`);
  }
  const a = heading && !secA ? [] : linesOf(before, secA);
  const b = heading && !secB ? [] : linesOf(after, secB);
  const sectionsB = sectionsOf(after);
  const sectionsA = sectionsOf(before);
  const where = (sections: Section[], line: number) => {
    const s = sections.filter((x) => x.line <= line && x.level > 1).pop();
    return s ? `${s.label ? `${s.label}: ` : ""}${s.text}` : "Opening";
  };

  let added = 0;
  let removed = 0;
  const counts = { edited: 0, added: 0, removed: 0 };
  const hunks: string[][] = [];
  let hunk: string[] | null = null;
  for (const op of alignBlocks(
    a.map((l) => l.key),
    b.map((l) => l.key),
  )) {
    if (op.op === "same") {
      hunk = null;
      continue;
    }
    if (!hunk) {
      hunk = [`@@ ${"b" in op ? where(sectionsB, b[op.b].line) : where(sectionsA, a[op.a].line)}`];
      hunks.push(hunk);
    }
    if (op.op === "removed") {
      counts.removed++;
      removed += countWords(a[op.a].key);
      hunk.push(`- L${a[op.a].line}  ${clip(a[op.a].text)}`);
    } else if (op.op === "added") {
      counts.added++;
      added += countWords(b[op.b].key);
      hunk.push(`+ L${b[op.b].line}  ${clip(b[op.b].text)}`);
    } else {
      counts.edited++;
      for (const p of wordDiff(a[op.a].text, b[op.b].text)) {
        if (p.removed) removed += countWords(p.value);
        if (p.added) added += countWords(p.value);
      }
      hunk.push(`~ L${a[op.a].line}→L${b[op.b].line}  ${markWords(a[op.a].text, b[op.b].text)}`);
    }
  }
  if (!hunks.length) return [...header, "", "No differences."].join("\n");

  header.push(
    `+${added.toLocaleString("en")} −${removed.toLocaleString("en")} words · ${counts.edited} edited, ${counts.added} added, ${counts.removed} removed paragraphs`,
    "Key: - removed (old line), + added (new line), ~ edited (old→new line) with [-old words-]{+new words+}; … is unchanged text left out.",
  );
  let out = header.join("\n");
  for (let i = 0; i < hunks.length; i++) {
    const text = `\n\n${hunks[i].join("\n")}`;
    if (out.length + text.length > MAX_DIFF_CHARS) {
      return `${out}\n\n(${hunks.length - i} more changes not shown; narrow it down with heading)`;
    }
    out += text;
  }
  return out;
}


const TOOLS: Tool[] = [
  // ─── Manuscript (read-only) ────────────────────────────────
  {
    name: "outline",
    description:
      "The manuscript's structure: title, parts and chapters with their line ranges and word counts, plus totals. Start here. Give a version id for a saved version's outline (its line numbers differ from today's).",
    inputSchema: {
      type: "object",
      properties: { version: str("Optional version id from list_versions; omit for the current manuscript.") },
    },
    readOnly: true,
    run: async (args, ctx) => {
      const vid = argString(args, "version", true);
      return formatOutline(vid ? await versionText(ctx.projectId, vid) : await manuscript(ctx.projectId));
    },
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

  {
    name: "grammar_check",
    description:
      "Spelling and grammar flags in the manuscript (or a Codex entry), from the same checker the writer sees underlined in the editor, with their dictionary and rule settings. Each flag has its line, the flagged words, the checker's message and its suggestions. The checker is mechanical: it flags dialect, invented words and deliberate fragments too, so judge each one in context before passing it on. Checking the whole book the first time can take several seconds; give a heading or lines to check part of it.",
    inputSchema: {
      type: "object",
      properties: {
        heading: str("Section to check: a label like \"Chapter 3\" or \"Part II\", or text from the heading."),
        from_line: int("First line (1-based)."),
        to_line: int("Last line, inclusive."),
        kind: { type: "string", enum: ["all", "spelling", "grammar"], description: "Which flags (default all)." },
        entry: str("A Codex entry id to check instead of the manuscript."),
      },
    },
    readOnly: true,
    run: async (args, ctx) => {
      const kind = argString(args, "kind", true) ?? "all";
      if (!["all", "spelling", "grammar"].includes(kind)) throw new ToolError(`"kind" must be all, spelling or grammar.`);
      const eid = args.entry ? entryId(args, "entry") : undefined;
      const text = eid ? (await entry(ctx.projectId, eid)).content : await manuscript(ctx.projectId);
      let from = argInt(args, "from_line") ?? 1;
      let to = argInt(args, "to_line") ?? Infinity;
      const heading = argString(args, "heading", true);
      let where = eid ? `the Codex entry "${eid}"` : "the manuscript";
      if (heading) {
        const s = findSection(text, heading);
        from = Math.max(from, s.line);
        to = Math.min(to, s.end);
        where = s.label || s.text;
      }
      if (from > 1 || to < Infinity) where += ` (lines ${from}–${Number.isFinite(to) ? to : "end"})`;
      // Codex entries have no pen:L links; line numbers are for reading them.
      return formatGrammar(await checkGrammar(text, from, to), where, kind, !eid);
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
        .map((v) => `${v.id}  ${stamp(v.created)}  ${v.kind}  ${v.words.toLocaleString("en")} words  ${v.label || "(unnamed)"}`)
        .join("\n");
    },
  },
  {
    name: "read_version",
    description:
      "Read a saved version of the manuscript, with line numbers. Like read_manuscript: give a heading and/or a line range, or neither for the whole text. Line numbers are the version's own (see outline with version).",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Version id from list_versions."),
        heading: str("Section to read: a label like \"Chapter 3\" or \"Part II\", or text from the heading."),
        from_line: int("First line (1-based)."),
        to_line: int("Last line, inclusive."),
      },
      required: ["id"],
    },
    readOnly: true,
    run: async (args, ctx) => excerpt(await versionText(ctx.projectId, argString(args, "id")), args),
  },
  {
    name: "diff_versions",
    description:
      "What changed between a saved version and the current manuscript (or another version): paragraphs added, removed and edited, with the edited words marked and line numbers on both sides. Give a heading to compare one section.",
    inputSchema: {
      type: "object",
      properties: {
        from: str("The older side: a version id from list_versions."),
        to: str("The newer side: another version id. Omit to compare with the current manuscript."),
        heading: str("Only this section (\"Chapter 3\", \"Part II\", or text from the heading), found in each text."),
      },
      required: ["from"],
    },
    readOnly: true,
    run: async (args, ctx) => {
      const from = argString(args, "from");
      const to = argString(args, "to", true);
      const before = await versionText(ctx.projectId, from);
      const after = to ? await versionText(ctx.projectId, to) : await manuscript(ctx.projectId);
      const header = [
        `From: ${await versionName(ctx.projectId, from)}`,
        `To: ${to ? await versionName(ctx.projectId, to) : "the current manuscript"}`,
      ];
      return diffMarkdown(before, after, argString(args, "heading", true), header);
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
      return createdEntry(created.id);
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
