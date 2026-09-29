import type { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { alignBlocks, blockKey, countWords, wordDiff } from "./textdiff";

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
    const key = blockKey(text);
    if (key) out.push({ node, pos, end: pos + node.nodeSize, text, at, key });
    return false;
  });
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

  // New blocks go after the last version block passed (or at the top).
  let lastEnd = 0;
  let pending: Block[] = [];
  const insertPending = () => {
    if (!pending.length) return;
    stop(lastEnd);
    decos.push(Decoration.widget(lastEnd, addedBlocks(pending), { side: -1, ignoreSelection: true }));
    added += pending.reduce((n, b) => n + countWords(b.key), 0);
    pending = [];
  };

  for (const op of alignBlocks(
    before.map((b) => b.key),
    after.map((b) => b.key),
  )) {
    if (op.op === "added") {
      pending.push(after[op.b]);
      continue;
    }
    insertPending();
    const b = before[op.a];
    lastEnd = b.end;
    if (op.op === "removed") {
      decos.push(Decoration.node(b.pos, b.end, { class: "diff-del-block" }));
      removed += countWords(b.key);
      stop(b.pos);
    } else if (op.op === "changed") {
      let o = 0;
      let replacing = false;
      for (const part of wordDiff(b.text, after[op.b].text)) {
        const len = part.value.length;
        const real = part.value.trim() !== "";
        if (part.removed) {
          if (real) {
            // Strike the words, not the spaces around them.
            const from = o + (part.value.length - part.value.trimStart().length);
            const to = o + part.value.trimEnd().length;
            decos.push(Decoration.inline(b.at[from], b.at[to - 1] + 1, { nodeName: "del", class: "diff-del" }));
            removed += countWords(part.value);
            stop(b.pos);
          }
          // The addition needs its own gap only if nothing separates it from the struck words.
          replacing = real && !/\s/.test(b.text[o + len - 1]);
          o += len;
        } else if (part.added) {
          if (real) {
            const pos = o < b.at.length ? b.at[o] : b.end - 1;
            decos.push(Decoration.widget(pos, addedText(part.value, replacing), { side: -1, marks: [] }));
            added += countWords(part.value);
            stop(b.pos);
          }
          replacing = false;
        } else {
          replacing = false;
          o += len;
        }
      }
    }
  }
  insertPending();

  return { decorations: DecorationSet.create(version, decos), stops, added, removed };
}
