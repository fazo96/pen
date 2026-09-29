import { diffArrays, diffWordsWithSpace } from "diff";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Changes between a version and the current draft, drawn as decorations on the
// version's read-only view: text gone since then is struck through in place,
// text added since then is shown as widgets. Loaded lazily by VersionPreview.

type Block = {
  node: PMNode;
  pos: number;
  end: number;
  /** Visible text, comments left out. */
  text: string;
  /** Document position of each character of `text`. */
  at: number[];
  /** Whitespace-normalised text, used to line blocks up. */
  key: string;
};

export type DocDiff = {
  decorations: DecorationSet;
  /** Where each change starts, in document order: the stops for ↑/↓. */
  stops: number[];
  added: number;
  removed: number;
};

const isComment = (n: PMNode) => n.marks.some((m) => m.type.name === "comment");
const words = (s: string) => s.match(/\S+/g)?.length ?? 0;

function blocks(doc: PMNode): Block[] {
  const out: Block[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "commentBlock") return false;
    if (!node.isTextblock) return true;
    let text = "";
    const at: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) {
        if (isComment(child)) return;
        for (let i = 0; i < child.text!.length; i++) at.push(start + i);
        text += child.text;
      } else {
        at.push(start); // a hard break reads as a space
        text += " ";
      }
    });
    const key = text.replace(/\s+/g, " ").trim();
    if (key) out.push({ node, pos, end: pos + node.nodeSize, text, at, key });
    return false;
  });
  return out;
}

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
function pair(removed: Block[], added: Block[]): number[] {
  const R = removed.length;
  const A = added.length;
  const out = new Array<number>(R).fill(-1);
  if (!R || !A || R * A > 40_000) return out;
  const ra = removed.map((b) => bag(b.key));
  const aa = added.map((b) => bag(b.key));
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

function addedBlocks(bs: Block[]) {
  return () => {
    const wrap = document.createElement("ins");
    wrap.className = "diff-ins-block";
    for (const b of bs) {
      const heading = b.node.type.name === "heading";
      const el = document.createElement(heading ? `h${b.node.attrs.level ?? 1}` : "p");
      el.textContent = b.text;
      wrap.appendChild(el);
    }
    return wrap;
  };
}

/** Added words; surrounding spaces stay outside the mark. */
function addedText(text: string, replacing: boolean) {
  return () => {
    const [, lead, core, trail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
    const wrap = document.createElement("span");
    const el = document.createElement("ins");
    el.className = replacing ? "diff-ins is-replacing" : "diff-ins";
    el.textContent = core;
    wrap.append(lead, el, trail);
    return wrap;
  };
}

type Part = { value: string; added?: boolean; removed?: boolean };

/**
 * Word diffs interleave ("~~with~~ carrying ~~nothing~~ only"); merge each run
 * of changes, spaces between them included, into one removal and one addition.
 */
function coalesce(parts: Part[]): Part[] {
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

/** Marks up `version` with what changed on the way to `draft`. */
export function diffDocs(version: PMNode, draft: PMNode): DocDiff {
  const before = blocks(version);
  const after = blocks(draft);
  const decos: Decoration[] = [];
  const stops: number[] = [];
  let added = 0;
  let removed = 0;
  const stop = (pos: number) => {
    if (stops[stops.length - 1] !== pos) stops.push(pos);
  };

  const insertBlocks = (pos: number, bs: Block[]) => {
    if (!bs.length) return;
    decos.push(Decoration.widget(pos, addedBlocks(bs), { side: -1, ignoreSelection: true }));
    added += bs.reduce((n, b) => n + words(b.key), 0);
  };

  // One hunk: a run of removed version blocks and added draft blocks.
  const hunk = (gone: Block[], fresh: Block[], anchor: number) => {
    const pairs = pair(gone, fresh);
    let j = 0;
    gone.forEach((b, i) => {
      const k = pairs[i];
      if (k < 0) {
        decos.push(Decoration.node(b.pos, b.end, { class: "diff-del-block" }));
        removed += words(b.key);
        stop(b.pos);
        return;
      }
      if (k > j) stop(b.pos);
      insertBlocks(b.pos, fresh.slice(j, k));
      j = k + 1;
      let o = 0;
      let replacing = false;
      for (const part of coalesce(diffWordsWithSpace(b.text, fresh[k].text))) {
        const len = part.value.length;
        const real = part.value.trim() !== "";
        if (part.removed) {
          if (real) {
            // Strike the words, not the spaces around them.
            const from = o + (part.value.length - part.value.trimStart().length);
            const to = o + part.value.trimEnd().length;
            decos.push(Decoration.inline(b.at[from], b.at[to - 1] + 1, { nodeName: "del", class: "diff-del" }));
            removed += words(part.value);
            stop(b.pos);
          }
          // The addition needs its own gap only if nothing separates it from the struck words.
          replacing = real && !/\s/.test(b.text[o + len - 1]);
          o += len;
        } else if (part.added) {
          if (real) {
            const pos = o < b.at.length ? b.at[o] : b.end - 1;
            decos.push(Decoration.widget(pos, addedText(part.value, replacing), { side: -1, marks: [] }));
            added += words(part.value);
            stop(b.pos);
          }
          replacing = false;
        } else {
          replacing = false;
          o += len;
        }
      }
    });
    const rest = fresh.slice(j);
    if (rest.length) {
      const pos = gone.length ? gone[gone.length - 1].end : anchor;
      stop(pos);
      insertBlocks(pos, rest);
    }
  };

  let bi = 0;
  let ai = 0;
  let gone: Block[] = [];
  let fresh: Block[] = [];
  const flush = () => {
    // Pure insertions go after the last unchanged block (or at the top).
    if (gone.length || fresh.length) hunk(gone, fresh, bi > 0 ? before[bi - 1].end : 0);
    gone = [];
    fresh = [];
  };
  for (const change of diffArrays(
    before.map((b) => b.key),
    after.map((b) => b.key),
  )) {
    const n = change.count;
    if (change.removed) {
      gone.push(...before.slice(bi, bi + n));
      bi += n;
    } else if (change.added) {
      fresh.push(...after.slice(ai, ai + n));
      ai += n;
    } else {
      flush();
      bi += n;
      ai += n;
    }
  }
  flush();

  return { decorations: DecorationSet.create(version, decos), stops, added, removed };
}
