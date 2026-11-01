// The writer's own pronunciations, for words the dictionary doesn't know
// (invented names) or says differently, shared by the whole library and kept
// in PEN_DIR/.pen-prosody.json. Pure, so the server, the browser and tests can
// all use it.

/** How the writer says a word: its stress (a mark per syllable), and/or English words it sounds like. */
export type OwnWord = { stress?: string; like?: string };

export type ProsodyConfig = {
  /** By wordKey. */
  words: Record<string, OwnWord>;
};

/** One change, as sent to PATCH /api/prosody. */
export type ProsodyPatch = {
  set?: { word: string } & OwnWord;
  remove?: string;
};

const MAX_WORDS = 5000;
const WORD_RE = /^\p{L}[\p{L}\p{M}']{0,63}$/u;
const STRESS_RE = /^[x/\\]{1,12}$/;
const LIKE_RE = /^[\p{L}\p{M}' -]{1,64}$/u;

export const emptyProsody = (): ProsodyConfig => ({ words: {} });

/** How words are matched: case and curly apostrophes don't matter. */
export const wordKey = (word: string): string => word.normalize("NFC").replace(/’/g, "'").toLowerCase();

function cleanWord(w: unknown): string | null {
  if (typeof w !== "string") return null;
  const key = wordKey(w.trim()).replace(/^'+|'+$/g, "");
  return WORD_RE.test(key) ? key : null;
}

function cleanOwn(raw: unknown): OwnWord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: OwnWord = {};
  if (typeof r.stress === "string" && STRESS_RE.test(r.stress)) out.stress = r.stress;
  if (typeof r.like === "string") {
    const like = wordKey(r.like).trim().replace(/\s+/g, " ");
    if (LIKE_RE.test(like)) out.like = like;
  }
  return out.stress || out.like ? out : null;
}

/** A config from untrusted JSON; anything malformed is dropped. */
export function sanitizeProsody(raw: unknown): ProsodyConfig {
  const out = emptyProsody();
  const words = (raw as { words?: unknown } | null)?.words;
  if (!words || typeof words !== "object") return out;
  for (const [w, v] of Object.entries(words).slice(-MAX_WORDS)) {
    const key = cleanWord(w);
    const own = cleanOwn(v);
    if (key && own) out.words[key] = own;
  }
  return out;
}

/** A patch from untrusted JSON, or null if it asks for nothing valid. */
export function sanitizeProsodyPatch(raw: unknown): ProsodyPatch | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const p: ProsodyPatch = {};
  const set = r.set as Record<string, unknown> | undefined;
  const word = cleanWord(set?.word);
  const own = cleanOwn(set);
  if (word && own) p.set = { word, ...own };
  const remove = cleanWord(r.remove);
  if (remove) p.remove = remove;
  return p.set || p.remove ? p : null;
}

/** The config with a patch applied: `set` replaces the word's pronunciation whole. */
export function applyProsodyPatch(config: ProsodyConfig, p: ProsodyPatch): ProsodyConfig {
  const words = { ...config.words };
  if (p.remove) delete words[p.remove];
  if (p.set) {
    const { word, ...own } = p.set;
    delete words[word]; // re-added last, so the oldest go first past MAX_WORDS
    words[word] = own;
  }
  const keys = Object.keys(words);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_WORDS))) delete words[k];
  return { words };
}
