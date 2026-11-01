import "server-only";
import { dictKey, SPELLING_RULE, visibleFlags } from "../grammarConfig";
import { flagsFor } from "../grammarServer";
import { getGrammar } from "../grammarStore";
import { lineOf, plainText, repeatedWords, type Flag, type PlacedFlag } from "../grammarText";
import { proseBlocks } from "./proseBlocks";

// The grammar checker the writer sees in the editor, run on the saved text for
// Construct: the markdown is parsed into the editor's document, each paragraph
// checked by Harper with the library's settings, and each flag given the line
// it's on. The flags come from ../grammarServer.ts, which the editor uses too,
// and a paragraph checked for either is found in its cache.

export type LineFlag = { line: number; flag: Flag };
export type GrammarReport = { flags: LineFlag[]; checked: number; words: { word: string; count: number }[] };

/** Flags in `md` (lines `from`–`to`, 1-based), as the editor would show them. */
export async function checkGrammar(md: string, from = 1, to = Infinity): Promise<GrammarReport> {
  const config = await getGrammar();
  const { blocks, starts, plainLines } = proseBlocks(md);
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
}
