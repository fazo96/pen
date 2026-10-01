// Word forms for the dictionary: which base forms a word might come from
// (WordNet's "morphy" suffix rules), and how to give a synonym the same form
// as the word it replaces ("walked" → strolled, "Walking" → Strolling).
//
// Kept free of pen imports so tests can load it with plain Node.

export type Pos = "n" | "v" | "a" | "r" | "s";

// WordNet's detachment rules: [ending, replacement, part of speech].
const RULES: [string, string, Pos][] = [
  ["s", "", "n"],
  ["ses", "s", "n"],
  ["xes", "x", "n"],
  ["zes", "z", "n"],
  ["ches", "ch", "n"],
  ["shes", "sh", "n"],
  ["men", "man", "n"],
  ["ies", "y", "n"],
  ["s", "", "v"],
  ["ies", "y", "v"],
  ["es", "e", "v"],
  ["es", "", "v"],
  ["ed", "e", "v"],
  ["ed", "", "v"],
  ["ing", "e", "v"],
  ["ing", "", "v"],
  ["er", "", "a"],
  ["est", "", "a"],
  ["er", "e", "a"],
  ["est", "e", "a"],
  ["ier", "y", "a"],
  ["iest", "y", "a"],
];

export type Candidate = { base: string; pos: Pos | null };

/** Base forms `word` could be an inflection of (itself first), lowercased, possessive dropped. */
export function baseCandidates(word: string): Candidate[] {
  const w = word
    .normalize("NFC")
    .trim()
    .replace(/[’‘]/g, "'")
    .replace(/'s$|s'$/i, (m) => (m.toLowerCase() === "s'" ? "s" : ""))
    .toLowerCase();
  const out: Candidate[] = [{ base: w, pos: null }];
  if (w.includes(" ")) return out;
  for (const [end, rep, pos] of RULES) {
    if (!w.endsWith(end) || w.length <= end.length + 1) continue;
    const base = w.slice(0, -end.length) + rep;
    out.push({ base, pos });
    // "stopped", "running", "bigger": the doubled consonant goes too.
    if (!rep && /([b-df-hj-np-tv-z])\1$/.test(base)) out.push({ base: base.slice(0, -1), pos });
  }
  const seen = new Set<string>();
  return out.filter((c) => !seen.has(c.base + c.pos) && seen.add(c.base + c.pos));
}

const VOWELS = /[aeiou]/;

/** One vowel group ending consonant-vowel-consonant (not w, x or y): "stop", "plan", "trek". */
function doubles(word: string) {
  const groups = word.match(/[aeiouy]+/g) ?? [];
  return groups.length === 1 && /[^aeiou][aeiou][b-df-hj-np-tv-z]$/.test(word) && !/[wxy]$/.test(word);
}

function addEnding(word: string, ending: "s" | "ed" | "ing" | "er" | "est"): string {
  const w = word;
  switch (ending) {
    case "s":
      if (/(s|x|z|ch|sh)$/.test(w)) return w + "es";
      if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + "ies";
      return w + "s";
    case "ing":
      if (w.endsWith("ie")) return w.slice(0, -2) + "ying";
      if (/[^aeioy]e$/.test(w) && w.length > 2) return w.slice(0, -1) + "ing";
      if (doubles(w)) return w + w.slice(-1) + "ing";
      return w + "ing";
    case "ed":
    case "er":
    case "est": {
      const tail = ending.slice(1); // "d", "r", "st"
      if (w.endsWith("e")) return w + tail;
      if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + "i" + ending;
      if (doubles(w)) return w + w.slice(-1) + ending;
      return w + ending;
    }
  }
}

/** Which regular ending turns `base` into `surface` (both lowercase), if any. */
export function endingOf(surface: string, base: string): "" | "s" | "ed" | "ing" | "er" | "est" | null {
  if (surface === base) return "";
  for (const e of ["s", "ed", "ing", "er", "est"] as const) {
    if (addEnding(base, e) === surface) return e;
  }
  return null;
}

function matchCase(word: string, like: string): string {
  if (like.length > 1 && like === like.toUpperCase() && like !== like.toLowerCase()) return word.toUpperCase();
  if (like[0] && like[0] === like[0].toUpperCase() && like[0] !== like[0].toLowerCase()) {
    return word[0].toUpperCase() + word.slice(1);
  }
  return word;
}

/** The word of a phrase that takes the ending: a verb's first ("walk about"), anything else's last. */
export function headWord(phrase: string, pos: Pos): string {
  const words = phrase.split(" ");
  return pos === "v" ? words[0] : words[words.length - 1];
}

// Endings irregular words don't take by the rules: "taked", "mouses", "gooder".
// (-ing and a verb's -s are regular even for them: "taking", "takes".)
const IRREGULAR_ENDINGS: Record<Pos, string[]> = { v: ["ed"], n: ["s"], a: ["er", "est"], s: ["er", "est"], r: ["er", "est"] };

/**
 * `synonym` in the form `surface` has as an inflection of `base`: "strolled"
 * for walk/"walked". Null when the form can't be carried over: the replaced
 * word's form is irregular ("went"), or the synonym's would be (`irregular`:
 * its head word has irregular forms, like "take"). The caller then uses the
 * plain synonym.
 */
export function inflectLike(synonym: string, base: string, surface: string, pos: Pos, irregular = false): string | null {
  const plainSurface = surface.replace(/['’]s$/i, "");
  const possessive = surface.slice(plainSurface.length);
  const ending = endingOf(plainSurface.toLowerCase(), base.toLowerCase());
  if (ending === null) return null;
  if (ending && irregular && IRREGULAR_ENDINGS[pos].includes(ending)) return null;
  let out = synonym;
  if (ending) {
    // Verbs change their first word ("walk about" → "walked about"), nouns their last.
    const words = synonym.split(" ");
    const i = pos === "v" ? 0 : words.length - 1;
    if (!VOWELS.test(words[i]) && !/y/.test(words[i])) return null;
    words[i] = addEnding(words[i], ending);
    out = words.join(" ");
  }
  return matchCase(out, plainSurface) + possessive;
}
