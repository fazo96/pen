import type { Node as PMNode } from "@tiptap/pm/model";

// Find and replace, the matching half: pure, so tests load it with plain Node.
// Everything with text is searched, comments and code included. Each textblock
// is read as one string (so a match can run across bold or italic), each
// character keeping its document position.

export type FindOptions = { caseSensitive: boolean; wholeWord: boolean };
export type Range = { from: number; to: number };
type Block = { text: string; at: number[] };

/** Past this many, the count reads "5000+" and the rest aren't drawn. */
export const MAX_MATCHES = 5000;

/** Every textblock's text with the document position of each character. */
export function findBlocks(doc: PMNode): Block[] {
  const out: Block[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const at: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) {
        const t = child.text!;
        for (let i = 0; i < t.length; i++) at.push(start + i);
        text += t;
      } else {
        // A line break ends a run of words; anything else is a character nothing matches.
        at.push(start);
        text += child.type.name === "hardBreak" ? "\n" : "￼";
      }
    });
    if (text) out.push({ text, at });
    return false;
  });
  return out;
}

const QUOTES: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"' };

/**
 * One UTF-16 unit in, one out, so positions line up: accents dropped, curly quotes
 * straightened, and the case too unless it counts. Surrogates pass through.
 */
function fold(s: string, caseSensitive: boolean): string {
  let out = "";
  for (const c of s) {
    if (c.length > 1) {
      out += c;
      continue;
    }
    let f = QUOTES[c] ?? c.normalize("NFD")[0];
    if (!caseSensitive) {
      const l = f.toLowerCase();
      if (l.length === 1) f = l;
    }
    out += f;
  }
  return out;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WORD = "[\\p{L}\\p{N}_]";

/**
 * The query as a pattern over folded text. "..." and "…" find each other, as do
 * "--" and "—", since Typography turns one into the other as you type (imports keep
 * either); a run of spaces finds any run of spaces. Null for an empty query.
 */
export function pattern(query: string, { caseSensitive, wholeWord }: FindOptions): RegExp | null {
  const q = fold(query.trim(), caseSensitive);
  if (!q) return null;
  let src = "";
  for (let i = 0; i < q.length; ) {
    if (q.startsWith("...", i) || q[i] === "…") {
      src += "(?:…|\\.\\.\\.)";
      i += q[i] === "…" ? 1 : 3;
    } else if (q.startsWith("--", i) || q[i] === "—") {
      src += "(?:—|--)";
      i += q[i] === "—" ? 1 : 2;
    } else if (/\s/.test(q[i])) {
      src += "\\s+";
      while (i < q.length && /\s/.test(q[i])) i++;
    } else {
      src += escapeRegExp(q[i]);
      i++;
    }
  }
  if (wholeWord) src = `(?<!${WORD})${src}(?!${WORD})`;
  return new RegExp(src, "gu");
}

/** Where the query is found, in document order; at most `limit` + 1 (to tell there are more). */
export function search(blocks: Block[], query: string, options: FindOptions, limit = MAX_MATCHES): Range[] {
  const re = pattern(query, options);
  if (!re) return [];
  const out: Range[] = [];
  for (const { text, at } of blocks) {
    const folded = fold(text, options.caseSensitive);
    re.lastIndex = 0;
    for (let m = re.exec(folded); m; m = re.exec(folded)) {
      if (!m[0].length) {
        re.lastIndex++;
        continue;
      }
      out.push({ from: at[m.index], to: at[m.index + m[0].length - 1] + 1 });
      if (out.length > limit) return out;
    }
  }
  return out;
}

/** The first match at or after `pos`, wrapping round to the first; -1 when there are none. */
export function matchFrom(matches: Range[], pos: number): number {
  if (!matches.length) return -1;
  const i = matches.findIndex((m) => m.from >= pos);
  return i < 0 ? 0 : i;
}
