import { diffArrays, diffWordsWithSpace } from "diff";

// How two texts differ, block by block (paragraphs, headings) and, inside
// edited blocks, word by word. Shared by the version preview (lib/diff.ts,
// drawn on the page) and Construct's diff_versions tool (as text).

export type Part = { value: string; added?: boolean; removed?: boolean };

/** One step through both texts, in document order; `a`/`b` index the old/new blocks. */
export type BlockOp =
  | { op: "same"; a: number; b: number }
  | { op: "removed"; a: number }
  | { op: "added"; b: number }
  | { op: "changed"; a: number; b: number };

export const countWords = (s: string) => s.match(/\S+/g)?.length ?? 0;

/** Whitespace-normalised text, for lining blocks up. */
export const blockKey = (s: string) => s.replace(/\s+/g, " ").trim();

function bag(s: string) {
  const m = new Map<string, number>();
  for (const w of s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

/** Word overlap (Dice) between two blocks, 0–1. */
function similarity(a: Map<string, number>, b: Map<string, number>) {
  let na = 0;
  let nb = 0;
  let common = 0;
  for (const n of a.values()) na += n;
  for (const [w, n] of b) {
    nb += n;
    common += Math.min(n, a.get(w) ?? 0);
  }
  return na + nb ? (2 * common) / (na + nb) : 0;
}

const SIMILAR = 0.4;

/**
 * Pairs the removed and added blocks of one hunk that look like edits of each
 * other, keeping document order. Returns, for each removed block, the index of
 * its added counterpart or -1.
 */
function pair(removed: string[], added: string[]): number[] {
  const R = removed.length;
  const A = added.length;
  const out = new Array<number>(R).fill(-1);
  if (!R || !A || R * A > 40_000) return out;
  const ra = removed.map(bag);
  const aa = added.map(bag);
  const sim = ra.map((r) => aa.map((a) => similarity(r, a)));
  // best[i][j]: highest total similarity pairing removed[i..] with added[j..].
  const best = Array.from({ length: R + 1 }, () => new Float64Array(A + 1));
  for (let i = R - 1; i >= 0; i--)
    for (let j = A - 1; j >= 0; j--) {
      const s = sim[i][j] >= SIMILAR ? sim[i][j] + best[i + 1][j + 1] : 0;
      best[i][j] = Math.max(best[i + 1][j], best[i][j + 1], s);
    }
  for (let i = 0, j = 0; i < R && j < A; ) {
    if (sim[i][j] >= SIMILAR && best[i][j] === sim[i][j] + best[i + 1][j + 1]) out[i++] = j++;
    else if (best[i][j] === best[i + 1][j]) i++;
    else j++;
  }
  return out;
}

/** Lines up two lists of block keys: unchanged, removed, added, and edited blocks. */
export function alignBlocks(before: string[], after: string[]): BlockOp[] {
  const ops: BlockOp[] = [];
  let bi = 0;
  let ai = 0;
  let gone: number[] = [];
  let fresh: number[] = [];
  const flush = () => {
    const pairs = pair(
      gone.map((i) => before[i]),
      fresh.map((i) => after[i]),
    );
    let j = 0;
    gone.forEach((a, i) => {
      const k = pairs[i];
      if (k < 0) {
        ops.push({ op: "removed", a });
        return;
      }
      for (; j < k; j++) ops.push({ op: "added", b: fresh[j] });
      ops.push({ op: "changed", a, b: fresh[k] });
      j = k + 1;
    });
    for (; j < fresh.length; j++) ops.push({ op: "added", b: fresh[j] });
    gone = [];
    fresh = [];
  };
  for (const change of diffArrays(before, after)) {
    for (let n = 0; n < change.count; n++) {
      if (change.removed) gone.push(bi++);
      else if (change.added) fresh.push(ai++);
      else {
        flush();
        ops.push({ op: "same", a: bi++, b: ai++ });
      }
    }
  }
  flush();
  return ops;
}

/**
 * Word changes between two versions of a block. Word diffs interleave
 * ("~~with~~ carrying ~~nothing~~ only"), so each run of changes, spaces between
 * them included, is merged into one removal and one addition.
 */
export function wordDiff(before: string, after: string): Part[] {
  const parts: Part[] = diffWordsWithSpace(before, after);
  const out: Part[] = [];
  const changed = (p?: Part) => !!p && (p.added || p.removed);
  for (let i = 0; i < parts.length; ) {
    if (!changed(parts[i])) {
      out.push(parts[i++]);
      continue;
    }
    let gone = "";
    let fresh = "";
    for (; i < parts.length; i++) {
      const p = parts[i];
      if (p.removed) gone += p.value;
      else if (p.added) fresh += p.value;
      else if (!p.value.trim() && changed(parts[i + 1])) {
        gone += p.value;
        fresh += p.value;
      } else break;
    }
    if (gone) out.push({ value: gone, removed: true });
    if (fresh) out.push({ value: fresh, added: true });
  }
  return out;
}
