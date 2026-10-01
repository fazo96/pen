import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { CACHE_DIR } from "./paths";
import { baseCandidates, headWord, type Pos } from "./wordforms";
import { buildWordnet, WORDNET_FILE } from "./wordnetBuild";

// Look-ups in Open English WordNet (CC-BY 4.0), from an index kept in the
// cache folder: made by lib/wordnetBuild.ts on the first look-up (a download
// of 10 MB) unless `npm run dictionary` made it already. Loaded then
// (about 40 MB of memory); each meaning stays a JSON string until it's asked for.

const DIR = path.join(CACHE_DIR, "wordnet");
const FILE = path.join(DIR, WORDNET_FILE);
// After a failed download, look-ups wait this long before trying again.
const RETRY_MS = 60_000;
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

let loading: Promise<Index> | null = null;
/** "take:v", "mouse:n": words with irregular forms. */
let irregulars: Set<string> | null = null;
let failedAt = 0;
let failure = "";

async function read(): Promise<Index | null> {
  try {
    const index = JSON.parse((await promisify(gunzip)(await readFile(FILE))).toString("utf8")) as Index;
    return index.v === 2 ? index : null; // an older format: made again
  } catch (err) {
    // Missing, or damaged: made again.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("dictionary:", err);
    return null;
  }
}

/** The index, made first if it isn't in the cache yet. Throws if it can't be had. */
function load(): Promise<Index> {
  loading ??= (async () => {
    let index = await read();
    if (!index) {
      if (Date.now() - failedAt < RETRY_MS) throw new Error(failure);
      console.log("dictionary: downloading Open English WordNet…");
      try {
        console.log(`dictionary: ${await buildWordnet(DIR)}`);
      } catch (err) {
        failedAt = Date.now();
        failure = `The dictionary couldn’t be downloaded (${(err as Error).message}).`;
        console.error("dictionary:", err);
        throw new Error(failure);
      }
      index = await read();
      if (!index) throw new Error("The dictionary couldn’t be read.");
    }
    irregulars = new Set(Object.values(index.f).flatMap((v) => v.split("|")));
    return index;
  })();
  loading.catch(() => (loading = null)); // try again next time
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

/** What the dictionary has for `word`. Throws (with a message for the writer) if the dictionary can't be had. */
export async function lookUp(word: string): Promise<Entry[]> {
  const index = await load();
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
