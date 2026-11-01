// Phonemes as the CMU Pronouncing Dictionary writes them (ARPAbet: "S AY1 L AH0 N S"):
// each vowel ends in its stress, 1 primary, 2 secondary, 0 none. Pure.

export type Syllable = { onset: string[]; vowel: string; coda: string[]; stress: 0 | 1 | 2 };

/** A syllable's mark, as the panel and the tests write stress: "/" stressed, "\" half, "x" light, "?" not known. */
export type Mark = "/" | "\\" | "x" | "?";

export const isVowel = (p: string) => /\d$/.test(p);
export const bare = (p: string) => p.replace(/\d$/, "");

// Consonant clusters English starts a syllable with (beyond single consonants):
// a run between two vowels gives the next syllable the longest of these it ends with.
const ONSETS = new Set(
  [
    ..."P B T D K G F TH SH".split(" ").map((c) => `${c} R`),
    ..."P B K G F S".split(" ").map((c) => `${c} L`),
    ..."T D K G S TH HH".split(" ").map((c) => `${c} W`),
    ..."P B K G F M V HH".split(" ").map((c) => `${c} Y`),
    ..."P T K M N L W F".split(" ").map((c) => `S ${c}`),
    "S P R",
    "S T R",
    "S K R",
    "S P L",
    "S K W",
    "S P Y",
    "S K Y",
  ],
);

const onsetLength = (run: string[]) => {
  for (let n = Math.min(3, run.length); n > 1; n--) if (ONSETS.has(run.slice(-n).join(" "))) return n;
  return run.length && run.at(-1) !== "NG" ? 1 : 0;
};

/** The phonemes split into syllables. */
export function syllables(phones: readonly string[]): Syllable[] {
  const out: Syllable[] = [];
  let run: string[] = [];
  for (const p of phones) {
    if (!isVowel(p)) {
      run.push(p);
      continue;
    }
    const prev = out.at(-1);
    const n = prev ? onsetLength(run) : run.length;
    if (prev) prev.coda = run.slice(0, run.length - n);
    out.push({ onset: run.slice(run.length - n), vowel: bare(p), coda: [], stress: Number(p.at(-1)) as 0 | 1 | 2 });
    run = [];
  }
  const last = out.at(-1);
  if (last) last.coda = run;
  return out;
}

const MARKS: Record<number, Mark> = { 0: "x", 1: "/", 2: "\\" };

/** The dictionary's stress, a mark per syllable ("/x" for silence). */
export const marksOf = (phones: readonly string[]): string =>
  phones
    .filter(isVowel)
    .map((p) => MARKS[Number(p.at(-1))])
    .join("");

/** Which syllable carries the word's main stress: the first primary, else the first secondary, else the first. */
export function mainSyllable(syls: readonly Syllable[]): number {
  const i = syls.findIndex((s) => s.stress === 1);
  if (i >= 0) return i;
  return Math.max(0, syls.findIndex((s) => s.stress === 2));
}

/** What a word rhymes on: its main stressed vowel and everything after ("AY L AH N S"). */
export function rhymeOf(phones: readonly string[]): string {
  const syls = syllables(phones);
  const i = mainSyllable(syls);
  return syls
    .slice(i)
    .flatMap((s, k) => (k ? [...s.onset, s.vowel, ...s.coda] : [s.vowel, ...s.coda]))
    .join(" ");
}

/** Phonemes with each vowel's stress replaced by `marks`' (as many as it has vowels). */
export function withMarks(phones: readonly string[], marks: string): string[] {
  let i = 0;
  const digit: Record<string, string> = { "/": "1", "\\": "2", x: "0", "?": "0" };
  return phones.map((p) => (isVowel(p) ? bare(p) + (digit[marks[i++]] ?? "0") : p));
}

// How a phoneme reads to someone who doesn't know ARPAbet.
const NAMES: Record<string, string> = {
  AA: "ah (father)",
  AE: "a (cat)",
  AH: "uh (cup)",
  AO: "aw (thought)",
  AW: "ow (cow)",
  AY: "eye (night)",
  EH: "e (bed)",
  ER: "er (bird)",
  EY: "ay (day)",
  IH: "i (sit)",
  IY: "ee (see)",
  OW: "oh (stone)",
  OY: "oy (boy)",
  UH: "oo (book)",
  UW: "oo (moon)",
  CH: "ch",
  DH: "th (this)",
  HH: "h",
  JH: "j",
  NG: "ng",
  SH: "sh",
  TH: "th (thin)",
  ZH: "zh (vision)",
};

/** "AY" → "eye (night)", "S" → "s"; several phonemes are joined ("AY T" → "eye-t"). */
export function soundName(sound: string): string {
  const parts = sound.split(" ").map(bare);
  if (parts.length === 1) return NAMES[parts[0]] ?? parts[0].toLowerCase();
  return parts.map((p) => (NAMES[p] ?? p).replace(/ \(.*\)$/, "").toLowerCase()).join("-");
}
