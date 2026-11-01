import { type Opening, openingsOf, type Sentence, sentencesOf } from "./cadence";
import { type Run, runsOf, type Syl, syllablesOf } from "./rhythm";
import { type SoundGroup, soundsOf } from "./sounds";
import { type Dict, type Word, wordsOf } from "./words";

// Cadence's reading of a passage of prose (a paragraph or a few): how each
// word is said, the rhythm its stresses make, the sounds that echo, and how
// its sentences end and begin. Pure, from the text and a pronouncing
// dictionary, so the page and Construct read a passage the same way.

export type Analysis = {
  words: Word[];
  syllables: Syl[];
  runs: Run[];
  sounds: SoundGroup[];
  sentences: Sentence[];
  openings: Opening[];
};

/** Read `text`; `flips` (word index → marks) tries other stresses on words ("what if this one's stressed?"). */
export function analyze(text: string, dict: Dict, flips?: Readonly<Record<number, string>>): Analysis {
  const words = wordsOf(text, dict, flips);
  const syllables = syllablesOf(words);
  const sentences = sentencesOf(words, syllables);
  return {
    words,
    syllables,
    runs: runsOf(syllables, words),
    sounds: soundsOf(words),
    sentences,
    openings: openingsOf(words, sentences),
  };
}

/** A dictionary's lookup from its compact text (lib/cmudictBuild.ts): a line per word, "word\tPHONES|PHONES". */
export function parseCompact(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab > 0) out.set(line.slice(0, tab), line.slice(tab + 1).split("|"));
  }
  return out;
}

export type { Dict, Opening, Run, Sentence, SoundGroup, Syl, Word };
