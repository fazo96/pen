import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { baseCandidates, headWord, type Pos } from "./wordforms";

// Look-ups in Open English WordNet (CC-BY 4.0), from the index that
// scripts/build-dictionary.mjs writes. Loaded on the first look-up (about
// 40 MB of memory); each meaning stays a JSON string until it's asked for.

const FILE = path.join(/*turbopackIgnore: true*/ process.cwd(), "dictionary", "oewn-2025.json.gz");
export const DICTIONARY_SOURCE = "Open English WordNet 2025";

type Index = { v: 2; w: Record<string, string>; s: string[]; f: Record<string, string>; p: Record<string, string> };
type Synset = [Pos, string, string[], string[], string[], string[], string[], string[]];

export type Sense = {
  pos: Pos;
  definition: string;
  examples: string[];
  /** Other words for this meaning. */
  synonyms: string[];
  similar: string[];
  broader: string[];
  narrower: string[];
  opposites: string[];
  /** Words above whose head word has irregular forms ("take"): an ending can't just be added. */
  irregular: string[];
};

export type Entry = {
  /** The dictionary's spelling ("November", "walk"). */
  lemma: string;
  pronunciation?: string;
  /** How the looked-up word relates: the same word, or an inflection of it. */
  via: "same" | "regular" | "irregular";
  senses: Sense[];
};

let loading: Promise<Index | null> | null = null;
/** "take:v", "mouse:n": words with irregular forms. */
let irregulars: Set<string> | null = null;

function load(): Promise<Index | null> {
  loading ??= (async () => {
    try {
      const raw = await promisify(gunzip)(await readFile(FILE));
      const index = JSON.parse(raw.toString("utf8")) as Index;
      if (index.v !== 2) throw new Error(`dictionary format ${index.v} is out of date: run npm run dictionary`);
      irregulars = new Set(Object.values(index.f).flatMap((v) => v.split("|")));
      return index;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("dictionary:", err);
      loading = null; // try again next time (e.g. after `npm run dictionary`)
      return null;
    }
  })();
  return loading;
}

const POS_ORDER: Record<Pos, number> = { v: 0, n: 1, a: 2, s: 2, r: 3 };

function senses(index: Index, key: string, prefer: Pos | null): { lemma: string; senses: Sense[] } | null {
  const list = index.w[key];
  if (!list) return null;
  let lemma = key;
  const other = (w: string) => w.toLowerCase() !== key;
  const out = list.split(",").map((n) => {
    const [pos, definition, examples, members, similar, broader, narrower, opposites] = JSON.parse(
      index.s[Number(n)],
    ) as Synset;
    lemma = members.find((m) => m.toLowerCase() === key) ?? lemma;
    const lists = {
      synonyms: members.filter(other),
      similar: similar.filter(other),
      broader: broader.filter(other),
      narrower: narrower.filter(other),
      opposites: opposites.filter(other),
    };
    const kind = pos === "s" ? "a" : pos;
    const irregular = [...new Set(Object.values(lists).flat())].filter((w) =>
      irregulars?.has(`${headWord(w, pos).toLowerCase()}:${kind}`),
    );
    return { pos, definition, examples, ...lists, irregular };
  });
  // WordNet orders meanings by how common they are; an inflection says which kind of word it is.
  if (prefer) {
    const kind = (p: Pos) => (p === "s" ? "a" : p);
    out.sort((a, b) => Number(kind(b.pos) === kind(prefer)) - Number(kind(a.pos) === kind(prefer)));
  }
  return { lemma, senses: out };
}

/** What the dictionary has for `word`; null if it isn't installed. */
export async function lookUp(word: string): Promise<Entry[] | null> {
  const index = await load();
  if (!index) return null;
  const entries: Entry[] = [];
  const seen = new Set<string>();
  const add = (key: string, via: Entry["via"], prefer: Pos | null) => {
    if (seen.has(key)) return;
    const found = senses(index, key, prefer);
    if (!found) return;
    seen.add(key);
    entries.push({ lemma: found.lemma, pronunciation: index.p[key], via, senses: found.senses });
  };
  const [self, ...rest] = baseCandidates(word);
  add(self.base, "same", null);
  for (const form of index.f[self.base]?.split("|") ?? []) {
    const [lemma, pos] = form.split(":");
    add(lemma, "irregular", (pos as Pos) || null);
  }
  for (const c of rest) add(c.base, "regular", c.pos);
  // The word itself first; then the rest, verbs before nouns when both match ("saw").
  return entries.sort(
    (a, b) =>
      Number(b.via === "same") - Number(a.via === "same") ||
      POS_ORDER[a.senses[0].pos] - POS_ORDER[b.senses[0].pos],
  );
}
