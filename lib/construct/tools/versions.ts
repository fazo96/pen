import "server-only";
import { listVersions, readVersion } from "../../docs";
import { type Section, sectionsOf } from "../../outline";
import { straightQuotes } from "../../text";
import { alignBlocks, blockKey, countWords, wordDiff } from "../../textdiff";
import { excerpt, findSection, manuscript, rangeProps, str, ToolError, tool } from "./core";

// The manuscript's saved versions: listing, reading and comparing them. Read-only.

const stamp = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

export async function versionText(projectId: string, vid: string) {
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

export const versionTools = [
  tool({
    name: "list_versions",
    description:
      "Saved versions of the manuscript, newest first: named ones the writer saved, and automatic ones (session starts, before restores).",
    properties: {},
    readOnly: true,
    run: async (_args, ctx) => {
      const list = await listVersions(ctx.projectId);
      if (!list.length) return "No saved versions yet.";
      return list
        .map((v) => `${v.id}  ${stamp(v.created)}  ${v.kind}  ${v.words.toLocaleString("en")} words  ${v.label || "(unnamed)"}`)
        .join("\n");
    },
  }),
  tool({
    name: "read_version",
    description:
      "Read a saved version of the manuscript, with line numbers. Like read_manuscript: give a heading and/or a line range, or neither for the whole text. Line numbers are the version's own (see outline with version).",
    properties: { id: str("Version id from list_versions."), ...rangeProps },
    required: ["id"],
    readOnly: true,
    run: async (args, ctx) => excerpt(await versionText(ctx.projectId, args.id), args),
  }),
  tool({
    name: "diff_versions",
    description:
      "What changed between a saved version and the current manuscript (or another version): paragraphs added, removed and edited, with the edited words marked and line numbers on both sides. Give a heading to compare one section.",
    properties: {
      from: str("The older side: a version id from list_versions."),
      to: str("The newer side: another version id. Omit to compare with the current manuscript."),
      heading: str("Only this section (\"Chapter 3\", \"Part II\", or text from the heading), found in each text."),
    },
    required: ["from"],
    readOnly: true,
    run: async ({ from, to, heading }, ctx) => {
      const before = await versionText(ctx.projectId, from);
      const after = to ? await versionText(ctx.projectId, to) : await manuscript(ctx.projectId);
      const header = [
        `From: ${await versionName(ctx.projectId, from)}`,
        `To: ${to ? await versionName(ctx.projectId, to) : "the current manuscript"}`,
      ];
      return diffMarkdown(before, after, heading, header);
    },
  }),
];
