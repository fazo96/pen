// Matching for the quick switcher and the command palette: pure, so tests load it with plain Node.

/** How well a query matched, and which characters of the text it hit (for highlighting). */
export type Match = { score: number; hits: number[] };

// Case and accents don't count: "cafe" finds "Café". One character in, one out, so hits line up.
const fold = (s: string) => Array.from(s, (c) => c.normalize("NFD")[0].toLowerCase()).join("");

const isWordStart = (t: string, i: number) => i === 0 || !/[\p{L}\p{N}]/u.test(t[i - 1]);

/** One word of the query against the text: as a run of characters if it can, else scattered. */
function matchTerm(term: string, text: string): Match | null {
  // A run: the earliest one starting a word, else the earliest anywhere.
  let at = -1;
  for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + 1)) {
    if (isWordStart(text, i)) {
      at = i;
      break;
    }
    if (at === -1) at = i;
  }
  if (at !== -1) {
    const hits = Array.from(term, (_, k) => at + k);
    const score = 100 + term.length * 10 + (isWordStart(text, at) ? 40 : 0) + (at === 0 ? 20 : 0) - at * 0.5;
    return { score, hits };
  }
  // Scattered, in order: each character at the next word start if there is one before the
  // next plain occurrence is passed, so "nc" takes the N and C of "new chat".
  const hits: number[] = [];
  let score = 0;
  let from = 0;
  for (const c of term) {
    let i = text.indexOf(c, from);
    if (i === -1) return null;
    for (let j = i; j !== -1; j = text.indexOf(c, j + 1)) {
      if (isWordStart(text, j)) {
        i = j;
        break;
      }
    }
    const prev = hits[hits.length - 1];
    score += isWordStart(text, i) ? 8 : prev === i - 1 ? 5 : 1;
    hits.push(i);
    from = i + 1;
  }
  return { score: score - (hits[hits.length - 1] - hits[0]) * 0.1, hits };
}

/**
 * Every word of the query must match the text, in any order (so "storm 12" finds
 * "12 The storm"). Null when one doesn't.
 */
export function match(query: string, text: string): Match | null {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return { score: 0, hits: [] };
  const t = fold(text);
  let score = 0;
  const hits = new Set<number>();
  for (const term of terms) {
    const m = matchTerm(term, t);
    if (!m) return null;
    score += m.score;
    for (const h of m.hits) hits.add(h);
  }
  return { score, hits: [...hits].sort((a, b) => a - b) };
}

/** Something to find: matched by its label, or more weakly by other words for it. */
export type Findable = { label: string; keywords?: string };

/** A row in the quick switcher or the command palette (components/Palette.tsx). */
export type PaletteItem = Findable & {
  key: string;
  /** Heading in the unfiltered list; a tag beside it in search results. */
  section: string;
  /** Before the label, unhighlighted: a chapter's number, say. */
  prefix?: string;
  /** Its keyboard shortcut. */
  hint?: string;
  /** Only in the unfiltered list, or only in search results (to avoid showing an item twice). */
  when?: "empty" | "search";
  /** Put the cursor back in the editor afterwards (when it was there). */
  refocus?: boolean;
  run?: () => void;
  /** A second step asking for text (a version's name), instead of `run`. */
  ask?: { placeholder: string; submit: (text: string) => void };
};

/** "go": the quick switcher; "do": commands, which is the switcher with ">" typed. */
export type PaletteMode = "go" | "do";

/**
 * The items that match, best first. Equal scores keep the given order (callers put
 * the more recent or more likely first). Hits are in the label; a match only in the
 * keywords has none.
 */
export function rank<T extends Findable>(items: T[], query: string): { item: T; hits: number[] }[] {
  const out: { item: T; hits: number[]; score: number; i: number }[] = [];
  items.forEach((item, i) => {
    const m = match(query, item.label);
    if (m) return out.push({ item, hits: m.hits, score: m.score, i });
    const k = item.keywords ? match(query, `${item.label} ${item.keywords}`) : null;
    if (k) out.push({ item, hits: k.hits.filter((h) => h < item.label.length), score: k.score / 2, i });
  });
  return out.sort((a, b) => b.score - a.score || a.i - b.i).map(({ item, hits }) => ({ item, hits }));
}

/** The label cut into plain and hit pieces, for drawing the highlight. */
export function pieces(label: string, hits: number[]): { text: string; hit: boolean }[] {
  const set = new Set(hits);
  const out: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < label.length; i++) {
    const hit = set.has(i);
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += label[i];
    else out.push({ text: label[i], hit });
  }
  return out;
}
