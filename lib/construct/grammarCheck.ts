import "server-only";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { Marked } from "marked";
import { lineSnippet } from "../cite";
import { CommentExtensions } from "../comments";
import { dictKey, effectiveRules, SPELLING_RULE, visibleFlags, type GrammarConfig } from "../grammarConfig";
import { getGrammar } from "../grammarStore";
import { blockLines, lineOf, plainText, repeatedWords, textBlocks, type Flag, type PlacedFlag } from "../grammarText";
import { PenOrderedList } from "../orderedList";
import { lintInWorker } from "./harperWorker";

// The grammar checker the writer sees in the editor, run on the saved text for
// Construct: the markdown is parsed into the editor's document, each paragraph
// checked by Harper with the library's settings, and each flag given the line
// it's on. Harper runs in a worker that ends when idle (see ./harperWorker.ts);
// paragraphs already checked are remembered here until the settings change,
// so checking unchanged text again doesn't need it.

export type LineFlag = { line: number; flag: Flag };
export type GrammarReport = { flags: LineFlag[]; checked: number; words: { word: string; count: number }[] };

const extensions = [StarterKit.configure({ heading: { levels: [1, 2, 3] }, orderedList: false }), PenOrderedList, ...CommentExtensions];
const schema = getSchema(extensions);
const markdown = new MarkdownManager({ marked: new Marked() as never, extensions });

const CACHE_LIMIT = 20000;
const cache = new Map<string, Flag[]>();
let configured = "";
let queue: Promise<unknown> = Promise.resolve();
// Texts per message to the worker.
const BATCH = 200;

async function flagsFor(texts: string[], config: GrammarConfig): Promise<Flag[][]> {
  const settings = { dialect: config.dialect, rules: effectiveRules(config), words: config.words };
  const signature = JSON.stringify(settings);
  if (signature !== configured) {
    configured = signature;
    cache.clear();
  }
  const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const found = await lintInWorker(batch, settings);
    batch.forEach((t, j) => cache.set(t, found[j]));
  }
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return texts.map((t) => cache.get(t) ?? []);
}

/** Flags in `md` (lines `from`–`to`, 1-based), as the editor would show them. */
export function checkGrammar(md: string, from = 1, to = Infinity): Promise<GrammarReport> {
  const run = queue.then(async () => {
    const config = await getGrammar();
    const doc = schema.nodeFromJSON(markdown.parse(md));
    const blocks = textBlocks(doc);
    // lineSnippet skips lines under 3 characters; only blank ones should read as empty.
    const plainLines = md.split("\n").map((l) => plainText(lineSnippet(l, Infinity) ?? l));
    const starts = blockLines(plainLines, blocks.map((b) => b.text));
    const inRange = blocks.map((b, i) => ({ b, line: starts[i] })).filter(({ line }) => line >= from && line <= to);
    const found = await flagsFor(inRange.map(({ b }) => b.text), config);
    const dictionary = new Set(config.words.map(dictKey));
    const ignored = new Set(config.ignored);
    const flags: LineFlag[] = [];
    const placed: PlacedFlag[] = [];
    inRange.forEach(({ b, line }, i) => {
      for (const flag of visibleFlags(found[i], config, dictionary, ignored)) {
        const offset = plainText(b.text.slice(0, flag.start)).length + (/\s$/.test(b.text.slice(0, flag.start)) ? 1 : 0);
        flags.push({ line: lineOf(plainLines, line, offset), flag });
        placed.push({ from: b.pos + flag.start, to: b.pos + flag.end, flag });
      }
    });
    const words = repeatedWords(placed, SPELLING_RULE, dictKey).map(({ word, count }) => ({ word, count }));
    return { flags, checked: inRange.length, words };
  });
  queue = run.catch(() => {});
  return run;
}
