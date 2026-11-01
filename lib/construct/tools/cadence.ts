import "server-only";
import { serverDict } from "../../pronunciations";
import { analyze } from "../../prosody";
import { sanitizeProsodyPatch, wordKey } from "../../prosody/own";
import { passageReport, SCAN_LEGEND } from "../../prosody/report";
import { getProsody, patchProsody } from "../../prosodyStore";
import { proseBlocks } from "../proseBlocks";
import { findSection, int, manuscript, str, text, tool, ToolError } from "./core";

// Cadence for Construct (docs/cadence.md): reading the sound of the
// manuscript, or of any text (its own suggestions, to check them), the way
// the writer's panel does; and the writer's own pronunciations, which it
// keeps as they do. A language model can't count syllables or hear stress
// reliably; these give it the same reading the writer sees.

/** A scan stops after this many paragraphs, and says how to see the rest. */
const MAX_PARAGRAPHS = 25;
const MAX_TEXT = 4000;

const ownLine = (word: string, own: { stress?: string; like?: string }) =>
  `${word}: ${[own.stress && `stress ${own.stress}`, own.like && `sounds like “${own.like}”`].filter(Boolean).join(", ")}`;

export const scanTool = tool({
  name: "scan_prose",
  description: `How prose sounds, read the way the writer's Cadence panel reads it: each word's stress, the rhythmic runs, the sounds that echo, how each sentence ends. Give a heading or lines of the manuscript (each paragraph cited as pen:L…), or text: any prose, such as a rewrite you're about to suggest, to check its rhythm before offering it. Use it rather than your own sense of syllables and stress, which isn't reliable. ${SCAN_LEGEND}`,
  properties: {
    heading: str('Section to read: a label like "Chapter 3" or "Part II", or text from the heading.'),
    from_line: int("First line (1-based)."),
    to_line: int("Last line, inclusive."),
    text: text(`Prose to read instead of the manuscript (up to ${MAX_TEXT} characters); paragraphs separated by blank lines.`),
  },
  readOnly: true,
  run: async (args, ctx) => {
    const dict = await serverDict().catch((err: Error) => {
      throw new ToolError(err.message);
    });
    if (args.text !== undefined) {
      const t = args.text.trim();
      if (!t) throw new ToolError("No text to read.");
      if (t.length > MAX_TEXT) throw new ToolError(`That's ${t.length} characters; read up to ${MAX_TEXT} at a time.`);
      const paragraphs = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      const reports = paragraphs.map((p, i) => passageReport(paragraphs.length > 1 ? `Paragraph ${i + 1}` : "The text", p, analyze(p, dict)));
      return [SCAN_LEGEND, "", ...reports.flatMap((r) => [r, ""])].join("\n").trim();
    }
    const md = await manuscript(ctx.projectId);
    let from = args.from_line ?? 1;
    let to = args.to_line ?? Infinity;
    if (args.heading) {
      const s = findSection(md, args.heading);
      from = Math.max(from, s.line);
      to = Math.min(to, s.end);
    }
    const { blocks, starts, types } = proseBlocks(md);
    // The prose: headings are left out.
    const inRange = blocks
      .map((b, i) => ({ b, line: starts[i], type: types[i] }))
      .filter(({ line, type }) => line >= from && line <= to && type !== "heading");
    if (!inRange.length) return "No paragraphs of prose in that range.";
    const shown = inRange.slice(0, MAX_PARAGRAPHS);
    const reports = shown.map(({ b, line }) => passageReport(`pen:L${line}`, b.text.trim(), analyze(b.text.trim(), dict)));
    const more =
      inRange.length > shown.length
        ? [`(${inRange.length - shown.length} more paragraphs not read: continue with from_line ${shown.at(-1)!.line + 1}.)`]
        : [];
    return [SCAN_LEGEND, "", ...reports.flatMap((r) => [r, ""]), ...more].join("\n").trim();
  },
});

export const pronunciationTools = [
  tool({
    name: "list_pronunciations",
    description:
      "The writer's own pronunciations, which Cadence and scan_prose use for words the dictionary doesn't know (invented names) or says differently. Shared by every book.",
    properties: {},
    readOnly: true,
    run: async () => {
      const { words } = await getProsody();
      const rows = Object.entries(words).map(([w, own]) => ownLine(w, own));
      return rows.length ? rows.join("\n") : "None set yet.";
    },
  }),
  tool({
    name: "set_pronunciation",
    description:
      "Say how a word is pronounced, for Cadence and scan_prose, in every book: its stress (a mark per syllable: / stressed, x light, \\ half; e.g. /x for DEN-na) and/or English words it sounds like (e.g. quoth for Kvothe), whose sounds it then takes so it joins the echoes. Replaces what was set for the word before. Do this when the writer tells you how a word is said, or asks you to; don't guess at their names unasked.",
    properties: {
      word: str("The word, as written (case doesn't matter)."),
      stress: str("A mark per syllable: / stressed, x light, \\ half. E.g. x/ for a-LONE."),
      sounds_like: str("Ordinary English words that sound like it, separated by spaces (e.g. “den uh”)."),
    },
    required: ["word"],
    readOnly: false,
    run: async (args, ctx) => {
      const patch = sanitizeProsodyPatch({ set: { word: args.word, stress: args.stress, like: args.sounds_like } });
      if (!patch?.set) {
        throw new ToolError(
          "Give one word of letters (apostrophes allowed), and a stress of up to 12 marks (/ x \\) and/or sounds_like in letters and spaces.",
        );
      }
      if (args.stress && patch.set.stress !== args.stress) throw new ToolError("The stress takes only the marks / x \\, one per syllable, up to 12.");
      if (args.sounds_like && !patch.set.like) throw new ToolError("sounds_like takes letters, spaces, apostrophes and hyphens, up to 64.");
      const { word, ...own } = patch.set;
      await patchProsody(patch);
      ctx.onProsodyChange();
      return `Set how “${word}” is said: ${ownLine(word, own).slice(word.length + 2)}.`;
    },
  }),
  tool({
    name: "remove_pronunciation",
    description: "Forget the writer's pronunciation of a word: Cadence goes back to the dictionary, or to guessing.",
    properties: { word: str("The word.") },
    required: ["word"],
    readOnly: false,
    run: async (args, ctx) => {
      const key = wordKey(args.word.trim());
      const { words } = await getProsody();
      if (!words[key]) throw new ToolError(`No pronunciation set for “${args.word}”.`);
      await patchProsody({ remove: key });
      ctx.onProsodyChange();
      return `Forgot how “${key}” is said.`;
    },
  }),
];
