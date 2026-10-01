import type { Node as PMNode } from "@tiptap/pm/model";

// Where the writer was in the manuscript, kept in the project's spot.json so it
// opens there again, on any device. Positions shift when the text is edited
// elsewhere, so each place also carries the opening words of its paragraph:
// it's found by those first, by position second.

/** A place in the text: its textblock (position and opening words) and how far into it. */
export type Place = { block: number; q: string; off: number };
/** The selection, and the text at the top of the screen. */
export type Spot = { anchor: Place; head: Place; top: Place };

const Q_LEN = 60;
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));

export function placeOf(doc: PMNode, pos: number): Place {
  const $pos = doc.resolve(clamp(pos, doc.content.size));
  if (!$pos.parent.isTextblock) return { block: $pos.pos, q: "", off: 0 };
  return { block: $pos.before(), q: norm($pos.parent.textContent).slice(0, Q_LEN), off: $pos.parentOffset };
}

type Block = { pos: number; size: number; dist: number };

/**
 * Where `place` is in `doc` now: in the nearest block starting with its words,
 * else (its opening was edited) in the block nearest its old position.
 */
export function posOf(doc: PMNode, place: Place): number {
  let match: Block | null = null;
  let near: Block | null = null;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const b = { pos, size: node.content.size, dist: Math.abs(pos - place.block) };
    if (!near || b.dist < near.dist) near = b;
    if ((!match || b.dist < match.dist) && norm(node.textContent).startsWith(place.q)) match = b;
    return false;
  });
  const found = (match ?? near) as Block | null;
  if (!found) return clamp(place.block, doc.content.size);
  return found.pos + 1 + Math.min(place.off, found.size);
}

const MAX_POS = 1e8;
const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < MAX_POS;

function sanitizePlace(x: unknown): Place | null {
  const p = x as Partial<Place> | null;
  if (!p || typeof p !== "object" || !isCount(p.block) || !isCount(p.off) || typeof p.q !== "string") return null;
  return { block: p.block, q: p.q.slice(0, Q_LEN * 2), off: p.off };
}

/** A Spot from untrusted JSON, or null. */
export function sanitizeSpot(x: unknown): Spot | null {
  const s = x as Partial<Record<keyof Spot, unknown>> | null;
  if (!s || typeof s !== "object") return null;
  const [anchor, head, top] = [sanitizePlace(s.anchor), sanitizePlace(s.head), sanitizePlace(s.top)];
  return anchor && head && top ? { anchor, head, top } : null;
}
