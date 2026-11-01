import type { Syl } from "./rhythm";
import type { Word } from "./words";

// The shape of each sentence: how long it is, how it ends (on a stress, a
// firm close; on a light syllable, falling away; on two stresses, a hard
// stop: "three parts"), and sentences that open with the same words. Pure.

export type Ending = "firm" | "falling" | "double" | "unknown";

export type Sentence = {
  /** Word indices, inclusive. */
  from: number;
  to: number;
  syllables: number;
  ending: Ending;
  /** Its last syllables' beats, up to four ("WSWS"). */
  close: string;
};

export type Opening = {
  /** As the first of them has it. */
  text: string;
  /** Sentence indices. */
  sentences: number[];
};

const MAX_OPENING = 3;

export function sentencesOf(words: readonly Word[], syls: readonly Syl[]): Sentence[] {
  const out: Sentence[] = [];
  let first = 0;
  for (let i = 0; i < words.length; i++) {
    if (i < words.length - 1 && words[i + 1].sentence === words[i].sentence) continue;
    const beats = syls.filter((s) => s.word >= first && s.word <= i).map((s) => s.beat);
    const [a, b] = [beats.at(-2), beats.at(-1)];
    const ending: Ending = b === "?" ? "unknown" : b === "W" ? "falling" : a === "S" ? "double" : "firm";
    out.push({ from: first, to: i, syllables: beats.length, ending, close: beats.slice(-4).join("") });
    first = i + 1;
  }
  return out;
}

/** Sentences that open alike: on two or three of the same words, or one that isn't a light function word. */
export function openingsOf(words: readonly Word[], sentences: readonly Sentence[]): Opening[] {
  const out: Opening[] = [];
  const claimed = new Set<number>();
  for (let n = MAX_OPENING; n >= 1; n--) {
    const groups = new Map<string, number[]>();
    sentences.forEach((s, i) => {
      if (claimed.has(i) || s.to - s.from + 1 <= n) return;
      if (n === 1 && words[s.from].light) return;
      const key = words
        .slice(s.from, s.from + n)
        .map((w) => w.key)
        .join(" ");
      groups.set(key, [...(groups.get(key) ?? []), i]);
    });
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      for (const i of list) claimed.add(i);
      const s = sentences[list[0]];
      out.push({ text: words.slice(s.from, s.from + n).map((w) => w.text).join(" "), sentences: list });
    }
  }
  return out.sort((a, b) => a.sentences[0] - b.sentences[0]);
}
