import { isVowel, marksOf, withMarks } from "./phones";
import { type OwnWord, wordKey } from "./own";

// The words of a passage and how each is said: split out of the text with
// where each sentence and clause ends, looked up (the writer's own words, the
// dictionary, then a word built from ones it knows, then a guess from the
// spelling), and given its stress in context: one-syllable function words
// ("the", "of", "was") go light, other one-syllable words are stressed.

/** A word's pronunciations, as the dictionary has them ("S AY1 L AH0 N S"), most usual first. */
export type Lookup = (key: string) => readonly string[] | undefined;

export type Dict = { lookup: Lookup; own: Readonly<Record<string, OwnWord>> };

/** Where a word's pronunciation came from. */
export type Source =
  | "dictionary"
  | "yours"
  /** Two words the dictionary knows (way + stone). */
  | "compound"
  /** A word it knows plus an ending (Kvothe's, waystones). */
  | "ending"
  /** Syllables counted from the spelling: no sounds, stress a first guess. */
  | "guess";

export type Word = {
  text: string;
  /** Offsets into the passage. */
  start: number;
  end: number;
  key: string;
  /** A mark per syllable. */
  stress: string;
  phones: string[] | null;
  source: Source;
  /** Other stress the dictionary gives it ("REcord" and "reCORD"). */
  alternatives: string[];
  /** A one-syllable function word, light in context. */
  light: boolean;
  /** Which sentence of the passage it's in. */
  sentence: number;
  /** What follows it: nothing, a clause's end (comma, dash…) or the sentence's. */
  pause: "" | "clause" | "sentence";
};

// One-syllable words that are light in running speech: articles, prepositions,
// conjunctions, pronouns, auxiliaries, "there was". (Demonstratives, "not" and
// question words are left out: they're often stressed.)
const FUNCTION_WORDS = new Set(
  `a an the of in on at to for from by with as up off than via o'er through like till and or but nor so yet if when while though there
  that whom who whose which i me my we us our you your he him his she her it its they them their 's
  is am are was were be been has had have do does did will would shall should can could may might must
  i'm i'd i'll i've you're you'd you'll you've he's he'd he'll she's she'd she'll it's it'd we're we'd we'll we've
  they're they'd they'll they've 'tis 'twas`.split(/\s+/),
);

// "Mr." doesn't end a sentence.
const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "st", "mt", "vs", "etc"]);

const WORD_RE = /[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}]|['’](?=\p{L}))*/gu;

type Pron = { phones: string[] | null; stress: string; source: Source; alternatives: string[] };

const phonesOf = (p: string) => p.split(" ");

function fromDictionary(prons: readonly string[]): Pron {
  const phones = phonesOf(prons[0]);
  const stress = marksOf(phones);
  const alternatives =
    stress.length > 1 ? [...new Set(prons.slice(1).map((p) => marksOf(phonesOf(p))))].filter((s) => s !== stress && s.length === stress.length) : [];
  return { phones, stress, source: "dictionary", alternatives };
}

/** The writer's word: what it sounds like, read from the dictionary, with their stress if they set one. */
function fromOwn(own: OwnWord, dict: Dict): Pron {
  const parts = own.like?.split(/[\s-]+/).map((w) => dict.lookup(w)?.[0]);
  let phones = parts?.every(Boolean) ? parts.flatMap((p) => phonesOf(p!)) : null;
  let stress = own.stress ?? (phones ? marksOf(phones) : "/");
  if (phones && own.stress) {
    if (phones.filter(isVowel).length === own.stress.length) phones = withMarks(phones, own.stress);
  } else if (phones && parts!.length > 1) {
    // Each word of a "sounds like" of several is said whole; one stress leads.
    const marks = marksOf(phones).replace(/\//g, "\\").replace("\\", "/");
    phones = withMarks(phones, marks);
    stress = marks;
  }
  return { phones, stress, source: "yours", alternatives: [] };
}

// Endings added to a word the dictionary knows: the spellings its base may
// take ("stopped" → stop, "carried" → carry, "making" → make), and the sound added.
type Ending = { suffix: string; bases: (stem: string) => string[]; sound: (base: string[]) => string[] };

const SIBILANT = new Set(["S", "Z", "SH", "ZH", "CH", "JH"]);
const VOICELESS = new Set(["P", "T", "K", "F", "TH", "S", "SH", "CH", "HH"]);
const sBase = (b: string[]) => (SIBILANT.has(b.at(-1)!) ? ["IH0", "Z"] : VOICELESS.has(b.at(-1)!) ? ["S"] : ["Z"]);
const edBase = (b: string[]) => (["T", "D"].includes(b.at(-1)!) ? ["IH0", "D"] : VOICELESS.has(b.at(-1)!) ? ["T"] : ["D"]);
const undouble = (s: string) => (/(.)\1$/.test(s) ? [s.slice(0, -1)] : []);
const yToI = (s: string) => (s.endsWith("i") ? [`${s.slice(0, -1)}y`] : []);

const ENDINGS: Ending[] = [
  { suffix: "'s", bases: (s) => [s], sound: sBase },
  { suffix: "'d", bases: (s) => [s], sound: () => ["D"] },
  { suffix: "'ll", bases: (s) => [s], sound: () => ["L"] },
  { suffix: "ies", bases: (s) => [`${s}y`], sound: () => ["Z"] },
  { suffix: "es", bases: (s) => [s, `${s}e`], sound: (b) => (SIBILANT.has(b.at(-1)!) ? ["IH0", "Z"] : ["Z"]) },
  { suffix: "s", bases: (s) => [s], sound: sBase },
  { suffix: "ed", bases: (s) => [s, `${s}e`, ...undouble(s), ...yToI(s)], sound: edBase },
  { suffix: "ing", bases: (s) => [s, `${s}e`, ...undouble(s)], sound: () => ["IH0", "NG"] },
  { suffix: "ly", bases: (s) => [s, ...yToI(s), `${s}le`], sound: () => ["L", "IY0"] },
  { suffix: "er", bases: (s) => [s, `${s}e`, ...undouble(s), ...yToI(s)], sound: () => ["ER0"] },
  { suffix: "est", bases: (s) => [s, `${s}e`, ...undouble(s), ...yToI(s)], sound: () => ["AH0", "S", "T"] },
  { suffix: "ness", bases: (s) => [s, ...yToI(s)], sound: () => ["N", "AH0", "S"] },
  { suffix: "less", bases: (s) => [s, ...yToI(s)], sound: () => ["L", "AH0", "S"] },
  { suffix: "ful", bases: (s) => [s, ...yToI(s)], sound: () => ["F", "AH0", "L"] },
];

function withEnding(key: string, dict: Dict): Pron | null {
  for (const e of ENDINGS) {
    if (!key.endsWith(e.suffix) || key.length - e.suffix.length < 2) continue;
    for (const base of e.bases(key.slice(0, -e.suffix.length))) {
      const b = known(base, dict);
      if (!b?.phones) continue;
      const phones = [...b.phones, ...e.sound(b.phones)];
      return { phones, stress: b.stress + marksOf(e.sound(b.phones)), source: "ending", alternatives: [] };
    }
  }
  return null;
}

/** The writer's pronunciation or the dictionary's. */
function known(key: string, dict: Dict): Pron | null {
  const own = dict.own[key];
  if (own) return fromOwn(own, dict);
  const prons = dict.lookup(key);
  return prons?.length ? fromDictionary(prons) : null;
}

/** Two words it knows, the first leading: way + stone. The split with the most even halves wins. */
function compound(key: string, dict: Dict): Pron | null {
  let best: [Pron, Pron] | null = null;
  let even = 0;
  for (let i = 3; i <= key.length - 3; i++) {
    const shorter = Math.min(i, key.length - i);
    if (shorter <= even) continue;
    const a = known(key.slice(0, i), dict);
    const b = a && (known(key.slice(i), dict) ?? withEnding(key.slice(i), dict));
    if (a?.phones && b?.phones) {
      best = [a, b];
      even = shorter;
    }
  }
  if (!best) return null;
  const [a, b] = best;
  const second = b.stress.replace(/\//g, "\\");
  return {
    phones: [...a.phones!, ...withMarks(b.phones!, second)],
    stress: a.stress + second,
    source: "compound",
    alternatives: [],
  };
}

/** Syllables from the spelling: vowel groups, less a silent final e. The first is taken as stressed. */
function guess(key: string): Pron {
  const letters = key.replace(/[^a-z]/g, "");
  let n = letters.match(/[aeiouy]+/g)?.length ?? 1;
  if (n > 1 && /[^aeiouy]e$/.test(letters) && !/[^aeiouy]le$/.test(letters)) n--;
  return { phones: null, stress: `/${"x".repeat(Math.max(0, n - 1))}`, source: "guess", alternatives: [] };
}

export function pronounce(key: string, dict: Dict): Pron {
  if (/\p{N}/u.test(key)) return { phones: null, stress: "?", source: "guess", alternatives: [] };
  return known(key, dict) ?? withEnding(key, dict) ?? compound(key, dict) ?? guess(key);
}

/** The stress a word takes in running text. */
function inContext(key: string, p: Pron): { stress: string; light: boolean } {
  if (p.stress.length !== 1 || p.stress === "?" || p.source === "yours") return { stress: p.stress, light: false };
  if (FUNCTION_WORDS.has(key)) return { stress: "x", light: true };
  return { stress: "/", light: false };
}

/** What separates a word from the next: a sentence's end, a clause's, or nothing. */
function pauseIn(gap: string, before: string, next: string | undefined): Word["pause"] {
  if (next === undefined) return "sentence";
  const ends = /[!?…]/.test(gap) || (gap.includes(".") && !(gap.startsWith(".") && ABBREVIATIONS.has(before)));
  // Unless a lowercase word follows: "Why?" he asked; and then… it went on.
  if (ends && !/^\p{Ll}/u.test(next)) return "sentence";
  if (ends || /[,;:()–—"“”]|--/.test(gap)) return "clause";
  return "";
}

/** The passage's words, pronounced, with `flips` (word index → marks) in place of their stress. */
export function wordsOf(text: string, dict: Dict, flips: Readonly<Record<number, string>> = {}): Word[] {
  const matches = [...text.matchAll(WORD_RE)];
  const out: Word[] = [];
  let sentence = 0;
  matches.forEach((m, i) => {
    const start = m.index!;
    const end = start + m[0].length;
    const key = wordKey(m[0]);
    const p = pronounce(key, dict);
    const ctx = inContext(key, p);
    const next = matches[i + 1];
    const pause = pauseIn(text.slice(end, next?.index ?? text.length), key, next?.[0]);
    const flip = flips[i];
    out.push({
      text: m[0],
      start,
      end,
      key,
      stress: flip && flip.length === ctx.stress.length ? flip : ctx.stress,
      phones: p.phones,
      source: p.source,
      alternatives: p.alternatives,
      light: ctx.light,
      sentence,
      pause,
    });
    if (pause === "sentence") sentence++;
  });
  return out;
}
