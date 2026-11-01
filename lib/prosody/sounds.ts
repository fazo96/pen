import { mainSyllable, rhymeOf, syllables } from "./phones";
import type { Word } from "./words";

// Sounds that echo between nearby words, by phoneme rather than spelling
// ("night" and "bright" rhyme, "though" and "tough" don't): alliteration (the
// same consonant opening the word or its stressed syllable), assonance (the
// same stressed vowel) and rhyme (the same stressed vowel and what follows).
// Light function words and words without phonemes take no part. Pure.

export type SoundKind = "alliteration" | "assonance" | "rhyme";

export type SoundGroup = {
  kind: SoundKind;
  /** The phonemes shared ("S", "AY", "AY T"): soundName() reads them out. */
  sound: string;
  /** Word indices, in order. */
  words: number[];
  /** A rhyme at the ends of clauses, where it sounds like verse: often not meant. */
  atEnds?: boolean;
};

// How far apart (in words) two echoes may be and still be heard together, and
// how many words make a group (assonance of two is everywhere).
const RULES: Record<SoundKind, { gap: number; min: number }> = {
  alliteration: { gap: 4, min: 2 },
  assonance: { gap: 4, min: 3 },
  rhyme: { gap: 12, min: 2 },
};

function keysOf(w: Word): Record<SoundKind, string[]> {
  const syls = syllables(w.phones!);
  if (!syls.length) return { alliteration: [], assonance: [], rhyme: [] };
  const main = syls[mainSyllable(syls)];
  const firsts = new Set<string>();
  if (syls[0].onset.length) firsts.add(syls[0].onset[0]);
  if (main.onset.length) firsts.add(main.onset[0]);
  return { alliteration: [...firsts], assonance: [main.vowel], rhyme: [rhymeOf(w.phones!)] };
}

/** The passage's echoes, in order of their first word. */
export function soundsOf(words: readonly Word[]): SoundGroup[] {
  const at: Record<SoundKind, Map<string, number[]>> = { alliteration: new Map(), assonance: new Map(), rhyme: new Map() };
  words.forEach((w, i) => {
    if (w.light || !w.phones) return;
    const keys = keysOf(w);
    for (const kind of Object.keys(at) as SoundKind[]) {
      for (const k of keys[kind]) at[kind].set(k, [...(at[kind].get(k) ?? []), i]);
    }
  });
  const out: SoundGroup[] = [];
  for (const kind of Object.keys(at) as SoundKind[]) {
    const { gap, min } = RULES[kind];
    for (const [sound, list] of at[kind]) {
      let group: number[] = [];
      const close = () => {
        // A word repeated is repetition, not an echo: the group needs two different words.
        if (group.length >= min && new Set(group.map((i) => words[i].key)).size >= 2) {
          const g: SoundGroup = { kind, sound, words: group };
          if (kind === "rhyme" && group.filter((i) => words[i].pause).length >= 2) g.atEnds = true;
          out.push(g);
        }
        group = [];
      };
      for (const i of list) {
        if (group.length && i - group.at(-1)! > gap) close();
        group.push(i);
      }
      close();
    }
  }
  return out.sort((a, b) => a.words[0] - b.words[0]);
}
