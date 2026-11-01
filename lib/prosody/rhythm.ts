import type { Mark } from "./phones";
import type { Word } from "./words";

// The passage's rhythm: each syllable as a beat (stressed or light, a half
// stress settled by its neighbours), and its rhythmic runs: stretches where
// every stress is followed by one or two light syllables, with no two stresses
// together and no three light ones, the pulse of near-verse prose. A run
// stays within its sentence and may cross its commas. Pure.

export type Beat = "S" | "W" | "?";

export type Syl = {
  word: number;
  /** As the word was given it. */
  mark: Mark;
  beat: Beat;
};

export type RunKind =
  /** x/ x/ x/ */
  | "iambic"
  /** /x /x /x */
  | "trochaic"
  /** xx/ xx/ */
  | "anapestic"
  /** /xx /xx */
  | "dactylic"
  /** Light syllables leading, feet of two and three mixed. */
  | "rising"
  | "falling";

export type Run = {
  /** Syllable indices, inclusive. */
  from: number;
  to: number;
  /** How many stresses. */
  feet: number;
  kind: RunKind;
  /** One kind of foot held so long it starts to sound like verse: sing-song in prose. */
  steady: boolean;
};

/** Runs with fewer stresses aren't worth pointing out. */
export const MIN_FEET = 3;
/** A run of one foot this long is steady. */
export const STEADY_FEET = 7;

/** The words' syllables, half stresses settled: stressed between light ones, light next to a stress. */
export function syllablesOf(words: readonly Word[]): Syl[] {
  const out: Syl[] = [];
  words.forEach((w, i) => {
    for (const m of w.stress) out.push({ word: i, mark: m as Mark, beat: m === "/" ? "S" : m === "x" ? "W" : "?" });
  });
  out.forEach((s, i) => {
    if (s.mark !== "\\") return;
    const prev = out[i - 1];
    const next = out[i + 1];
    const sameSentence = (o?: Syl) => o && words[o.word].sentence === words[s.word].sentence;
    const prevStressed = sameSentence(prev) && prev!.beat === "S";
    const nextStressed = sameSentence(next) && next!.mark === "/";
    s.beat = prevStressed || nextStressed ? "W" : "S";
  });
  return out;
}

function kindOf(lead: number, gaps: number[]): RunKind {
  const rising = lead > 0;
  if (gaps.every((g) => g === 1)) return rising ? "iambic" : "trochaic";
  if (gaps.every((g) => g === 2)) return rising ? "anapestic" : "dactylic";
  return rising ? "rising" : "falling";
}

/** The rhythmic runs among the syllables, in order. */
export function runsOf(syls: readonly Syl[], words: readonly Word[]): Run[] {
  const runs: Run[] = [];
  // Stretches to look in: a sentence, cut where a syllable's stress isn't known.
  const stretches: [number, number][] = [];
  let a = 0;
  for (let i = 0; i <= syls.length; i++) {
    const end =
      i === syls.length || syls[i].beat === "?" || (i > a && words[syls[i].word].sentence !== words[syls[i - 1].word].sentence);
    if (!end) continue;
    if (i > a) stretches.push([a, i - 1]);
    a = syls[i]?.beat === "?" ? i + 1 : i;
  }
  for (const [from, to] of stretches) {
    const stresses: number[] = [];
    for (let i = from; i <= to; i++) if (syls[i].beat === "S") stresses.push(i);
    let taken = from - 1; // the last syllable a run here has used
    let group: number[] = [];
    const close = (nextStress: number) => {
      if (group.length >= MIN_FEET) {
        const first = group[0];
        const last = group.at(-1)!;
        const lead = Math.min(2, first - Math.max(from, taken + 1, (stresses[stresses.indexOf(first) - 1] ?? -1) + 1));
        const trail = Math.min(2, Math.min(to, nextStress - 1) - last);
        const gaps = group.slice(1).map((s, k) => s - group[k] - 1);
        const kind = kindOf(lead, gaps);
        const pure = kind !== "rising" && kind !== "falling";
        runs.push({ from: first - lead, to: last + trail, feet: group.length, kind, steady: pure && group.length >= STEADY_FEET });
        taken = last + trail;
      }
      group = [];
    };
    stresses.forEach((s, k) => {
      const gap = k ? s - stresses[k - 1] - 1 : 1;
      if (gap !== 1 && gap !== 2) close(s);
      group.push(s);
    });
    close(to + 1);
  }
  return runs;
}
