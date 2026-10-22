import "server-only";
import { isValidId, MAX_BYTES, readDoc, readEntry } from "../../docs";
import { type Section, sectionsOf } from "../../outline";
import type { ToolName } from "../types";

// What every tool is made of: its JSON schema, which is both what the agent
// is shown and what its arguments are checked and typed against (readArgs),
// and the helpers the tools share.

/** `moved`: to the other Codex (the Global Codex, or from it into the book), as `to`; `global` says where it was. */
export type CodexChange = { entry: string; action: "created" | "edited" | "renamed" | "deleted" | "moved"; to?: string; global?: boolean };

export type ToolContext = {
  /** The book, or GLOBAL in the Global Codex's own chats. */
  projectId: string;
  /** Called after every change to the Codex, so open views can refresh. */
  onCodexChange: (change: CodexChange) => void;
};

/** A failure the agent should see and can act on. */
export class ToolError extends Error {}

// ─── Arguments ───────────────────────────────────────────────

/** A string that may be empty (an empty one is otherwise taken as left out). */
const EMPTY_OK = Symbol("empty ok");
/** A Codex entry id, checked with isValidId. */
const ENTRY_ID = Symbol("entry id");

type StringProp = { type: "string"; description: string; enum?: readonly string[]; [EMPTY_OK]?: true; [ENTRY_ID]?: true };
type IntProp = { type: "integer"; minimum: 1; description: string };
type BoolProp = { type: "boolean"; description: string };
type Prop = StringProp | IntProp | BoolProp;
export type Props = Record<string, Prop>;

export const str = (description: string): StringProp => ({ type: "string", description });
export const text = (description: string): StringProp => ({ type: "string", description, [EMPTY_OK]: true });
export const entryIdProp = (description: string): StringProp => ({ type: "string", description, [ENTRY_ID]: true });
export const oneOf = <const E extends readonly string[]>(values: E, description: string) =>
  ({ type: "string", enum: values, description }) as const;
export const int = (description: string): IntProp => ({ type: "integer", minimum: 1, description });
export const bool = (description: string): BoolProp => ({ type: "boolean", description });

type ValueOf<P> = P extends { enum: readonly (infer E)[] } ? E : P extends { type: "integer" } ? number : P extends { type: "boolean" } ? boolean : string;
export type Args<P extends Props, R extends keyof P> = { [K in R]: ValueOf<P[K]> } & { [K in Exclude<keyof P, R>]?: ValueOf<P[K]> };

/** The arguments the schema describes, checked: anything else is left out. */
export function readArgs<P extends Props, R extends keyof P>(properties: P, required: readonly R[], input: Record<string, unknown>): Args<P, R> {
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(properties)) {
    const v = readArg(key, prop, input[key]);
    if (v !== undefined) out[key] = v;
    else if ((required as readonly string[]).includes(key)) throw new ToolError(`Missing "${key}".`);
  }
  return out as Args<P, R>;
}

function readArg(key: string, prop: Prop, v: unknown): unknown {
  if (v === undefined || v === null) return undefined;
  if (prop.type === "integer") {
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isInteger(n) || n < prop.minimum) throw new ToolError(`"${key}" must be a positive integer.`);
    return n;
  }
  if (prop.type === "boolean") {
    if (v === true || v === "true") return true;
    if (v === false || v === "false") return false;
    throw new ToolError(`"${key}" must be true or false.`);
  }
  if (typeof v !== "string") throw new ToolError(`"${key}" must be a string.`);
  if (v === "" && !prop[EMPTY_OK]) return undefined;
  if (prop.enum && !prop.enum.includes(v)) throw new ToolError(`"${key}" must be one of: ${prop.enum.join(", ")}.`);
  if (prop[ENTRY_ID] && !isValidId(v)) throw new ToolError(`"${v}" is not a valid entry id (lowercase letters, digits and dashes).`);
  return v;
}

// ─── Tools ───────────────────────────────────────────────────

export type Tool = {
  name: ToolName;
  description: string;
  inputSchema: { type: "object"; properties: Props; required?: string[] };
  readOnly: boolean;
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
};

/** A tool whose `run` gets its arguments checked and typed from `properties` and `required`. */
export function tool<const P extends Props, const R extends keyof P & string = never>(t: {
  name: ToolName;
  description: string;
  properties: P;
  required?: readonly R[];
  readOnly: boolean;
  run: (args: Args<P, R>, ctx: ToolContext) => Promise<string>;
}): Tool {
  const required = t.required ?? [];
  return {
    name: t.name,
    description: t.description,
    inputSchema: { type: "object", properties: t.properties, ...(required.length ? { required: [...required] } : {}) },
    readOnly: t.readOnly,
    run: (input, ctx) => t.run(readArgs(t.properties, required, input), ctx),
  };
}

// ─── Shared helpers ──────────────────────────────────────────

export async function manuscript(projectId: string) {
  const doc = await readDoc(projectId);
  if (!doc) throw new ToolError("The manuscript is missing.");
  return doc.content;
}

export async function entry(projectId: string, eid: string) {
  const e = await readEntry(projectId, eid);
  if (!e) throw new ToolError(`No Codex entry "${eid}". Use list_codex to see the ids.`);
  return e;
}

export function checkSize(content: string) {
  if (Buffer.byteLength(content) > MAX_BYTES) throw new ToolError("Too large (max 5 MB).");
}

/** Find a heading by label ("Chapter 3", "Part II") or by (part of) its text. */
export function findSection(markdown: string, query: string) {
  const sections = sectionsOf(markdown);
  const q = query.trim().toLowerCase();
  const exact = sections.find((s) => s.label.toLowerCase() === q || s.text.toLowerCase() === q);
  const match = exact ?? sections.find((s) => s.text.toLowerCase().includes(q));
  if (!match) throw new ToolError(`No heading matches "${query}". Use outline to see them.`);
  return match;
}

/** The most one read returns; past it, the agent reads on with `offset`. */
const READ_LINES = 2000;
const READ_CHARS = 50_000;

/** The arguments of the tools that read part of a text. */
export const rangeProps = {
  heading: str("Section to read: a label like \"Chapter 3\" or \"Part II\", or text from the heading."),
  offset: int("Line to start at (1-based, as numbered in the output; within the section when a heading is given)."),
  limit: int(`How many lines to read (at most ${READ_LINES}).`),
};

/**
 * Lines of a document, numbered, optionally limited to a section, from
 * `offset` for `limit` lines. A read stops at READ_LINES lines or about
 * READ_CHARS characters, at a whole line, and says where to go on from, so
 * any document can be read whole a page at a time.
 */
export function excerpt(markdown: string, range: { heading?: string; offset?: number; limit?: number }) {
  const lines = markdown.split("\n");
  let from = range.offset ?? 1;
  let end = lines.length;
  if (range.heading) {
    const s = findSection(markdown, range.heading);
    from = Math.max(from, s.line);
    end = s.end;
  }
  if (from > end) {
    return range.heading ? `(no lines: the section ends at line ${end})` : `(no lines: the document has ${lines.length})`;
  }
  const last = Math.min(end, from + Math.min(range.limit ?? READ_LINES, READ_LINES) - 1);
  const width = String(last).length;
  const out: string[] = [];
  let size = 0;
  let to = from - 1;
  for (let n = from; n <= last; n++) {
    let line = `${String(n).padStart(width)}\t${lines[n - 1]}`;
    if (size + line.length > READ_CHARS) {
      if (out.length) break;
      // A line longer than a whole read: only its start fits.
      line = `${line.slice(0, READ_CHARS)}… (line ${n} cut: it's over ${READ_CHARS.toLocaleString("en")} characters)`;
    }
    out.push(line);
    size += line.length + 1;
    to = n;
  }
  const body = `Lines ${from}–${to} of ${lines.length}:\n${out.join("\n")}`;
  if (to === end) return body;
  const more = end - to;
  return `${body}\n(${more.toLocaleString("en")} more line${more > 1 ? "s" : ""}${range.heading ? " in this section" : ""}: continue with offset ${to + 1}.)`;
}

/** An outline's rows: each heading indented by its level, with its lines and words; `labels` adds the manuscript's numbering. */
export function outlineRows(sections: Section[], labels: boolean) {
  return sections.map((s) => {
    const indent = "  ".repeat(Math.max(0, s.level - 1));
    const name = labels && s.label ? `${s.label}: ${s.text}` : s.text;
    return `${indent}${name}  (lines ${s.line}–${s.end}, ${s.words.toLocaleString("en")} words)`;
  });
}
