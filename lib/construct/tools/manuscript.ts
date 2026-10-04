import "server-only";
import { listCodex, readEntry } from "../../docs";
import { ruleLabel } from "../../grammarConfig";
import { sectionsOf } from "../../outline";
import { titleOf, wordCount } from "../../text";
import { checkGrammar, type GrammarReport } from "../grammarCheck";
import { entry, entryIdProp, excerpt, findSection, int, manuscript, oneOf, rangeProps, str, tool } from "./core";
import { versionText } from "./versions";

// Reading the manuscript: its outline, its text, searching it, checking it.
// Read-only: no tool writes the manuscript.

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

export const manuscriptTools = [
  tool({
    name: "outline",
    description:
      "The manuscript's structure: title, parts and chapters with their line ranges and word counts, plus totals. Start here. Give a version id for a saved version's outline (its line numbers differ from today's).",
    properties: { version: str("Optional version id from list_versions; omit for the current manuscript.") },
    readOnly: true,
    run: async ({ version }, ctx) =>
      formatOutline(version ? await versionText(ctx.projectId, version) : await manuscript(ctx.projectId)),
  }),
  tool({
    name: "read_manuscript",
    description:
      "Read the manuscript (markdown), with line numbers. Give a heading (\"Chapter 3\", \"Part II\", or part of a heading's text) to read one section, and/or a line range. Without either, returns the whole text.",
    properties: rangeProps,
    readOnly: true,
    run: async (args, ctx) => excerpt(await manuscript(ctx.projectId), args),
  }),
  tool({
    name: "search",
    description:
      "Find text in the manuscript and/or the Codex (case-insensitive). Returns matching lines with their line numbers and the chapter they're in.",
    properties: {
      query: str("Text to look for."),
      scope: oneOf(["all", "manuscript", "codex"], "Where to look (default all)."),
    },
    required: ["query"],
    readOnly: true,
    run: async (args, ctx) => {
      const query = args.query.toLowerCase();
      const scope = args.scope ?? "all";
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
  }),
  tool({
    name: "grammar_check",
    description:
      "Spelling and grammar flags in the manuscript (or a Codex entry), from the same checker the writer sees underlined in the editor, with their dictionary and rule settings. Each flag has its line, the flagged words, the checker's message and its suggestions. The checker is mechanical: it flags dialect, invented words and deliberate fragments too, so judge each one in context before passing it on. Checking the whole book the first time can take several seconds; give a heading or lines to check part of it.",
    properties: {
      heading: str("Section to check: a label like \"Chapter 3\" or \"Part II\", or text from the heading."),
      from_line: int("First line (1-based)."),
      to_line: int("Last line, inclusive."),
      kind: oneOf(["all", "spelling", "grammar"], "Which flags (default all)."),
      entry: entryIdProp("A Codex entry id to check instead of the manuscript."),
    },
    readOnly: true,
    run: async (args, ctx) => {
      const kind = args.kind ?? "all";
      const eid = args.entry;
      const text = eid ? (await entry(ctx.projectId, eid)).content : await manuscript(ctx.projectId);
      let from = args.from_line ?? 1;
      let to = args.to_line ?? Infinity;
      let where = eid ? `the Codex entry "${eid}"` : "the manuscript";
      if (args.heading) {
        const s = findSection(text, args.heading);
        from = Math.max(from, s.line);
        to = Math.min(to, s.end);
        where = s.label || s.text;
      }
      if (from > 1 || to < Infinity) where += ` (lines ${from}–${Number.isFinite(to) ? to : "end"})`;
      // Codex entries have no pen:L links; line numbers are for reading them.
      return formatGrammar(await checkGrammar(text, from, to), where, kind, !eid);
    },
  }),
];
