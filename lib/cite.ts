import type { Node as PMNode } from "@tiptap/pm/model";
import { straightQuotes } from "./text";

// Construct cites passages with markdown links:
//   pen:L120 or pen:L120-140          lines of the manuscript
//   pen:v/<version id>/L40            lines of a saved version
//   pen:codex/<entry id>              a Codex entry
// Line numbers go stale as the writer edits, so when a turn ends the server
// adds the start of each cited line (?q=, and ?qe= for a range's last line);
// the panel finds the passage by that text first and by line number second.

export type LineCitation = { from: number; to: number; q?: string; qe?: string };
export type Citation =
  | ({ kind: "manuscript" } & LineCitation)
  | ({ kind: "version"; version: string } & LineCitation)
  | { kind: "codex"; entry: string };

const LINES = String.raw`L(\d+)(?:-L?(\d+))?`;
const MANUSCRIPT_RE = new RegExp(`^${LINES}$`);
const VERSION_RE = new RegExp(`^v/([\\w-]+)/${LINES}$`);
const CODEX_RE = /^codex\/([a-z0-9][a-z0-9-]{0,79})$/;

export function parseCitation(href: string): Citation | null {
  if (!href.startsWith("pen:")) return null;
  const [path, query = ""] = href.slice(4).split("?", 2);
  const params = new URLSearchParams(query);
  const lines = (from: string, to?: string): LineCitation | null => {
    const f = Number(from);
    const t = Math.max(f, Number(to ?? from));
    return f >= 1 ? { from: f, to: t, q: params.get("q") || undefined, qe: params.get("qe") || undefined } : null;
  };
  let m = CODEX_RE.exec(path);
  if (m) return { kind: "codex", entry: m[1] };
  m = VERSION_RE.exec(path);
  if (m) {
    const l = lines(m[2], m[3]);
    return l && { kind: "version", version: m[1], ...l };
  }
  m = MANUSCRIPT_RE.exec(path);
  if (m) {
    const l = lines(m[1], m[2]);
    return l && { kind: "manuscript", ...l };
  }
  return null;
}

/** The start of a markdown line as plain text: what the writer sees there. */
export function lineSnippet(line: string | undefined, max = 60): string | undefined {
  if (!line) return undefined;
  const plain = straightQuotes(line)
    .replace(/%%[\s\S]*?%%|<!--[\s\S]*?-->/g, " ")
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)*/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\(.)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length < 3) return undefined;
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return space > max / 2 ? cut.slice(0, space) : cut;
}

const norm = (s: string) =>
  straightQuotes(s)
    .toLowerCase()
    .replace(/[*_`~\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

type TextBlock = { pos: number; end: number; text: string };

function textBlocks(doc: PMNode): TextBlock[] {
  const out: TextBlock[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    out.push({ pos, end: pos + node.nodeSize, text: norm(node.textContent) });
    return false;
  });
  return out;
}

/**
 * Where a cited passage is in `doc`, whose markdown is `lines`: found by the
 * quoted text, else by what's at the line number now. Null if neither works.
 */
export function findPassage(doc: PMNode, lines: string[], c: LineCitation): { from: number; to: number } | null {
  const blocks = textBlocks(doc);
  if (!blocks.length) return null;
  // Of several blocks containing the text, take the one nearest the line's place in the text.
  const locate = (text: string | undefined, line: number) => {
    const n = text && norm(text);
    if (!n) return null;
    const expected = (line / Math.max(1, lines.length)) * blocks.length;
    let best: number | null = null;
    blocks.forEach((b, i) => {
      if (b.text.includes(n) && (best === null || Math.abs(i - expected) < Math.abs(best - expected))) best = i;
    });
    return best;
  };
  // The first non-blank line at or after `line`, as it reads now.
  const atLine = (line: number) => {
    for (let l = line; l < line + 3 && l <= lines.length; l++) {
      const s = lineSnippet(lines[l - 1]);
      if (s) return locate(s, l);
    }
    return null;
  };
  const start = locate(c.q, c.from) ?? atLine(c.from);
  if (start === null) return null;
  let end = start;
  if (c.to > c.from) {
    const e = locate(c.qe, c.to) ?? atLine(c.to);
    if (e !== null && e >= start) end = e;
  }
  return { from: blocks[start].pos, to: blocks[end].end };
}

/** A citation link with the cited lines' text added, for `pen:` hrefs that don't have it yet. */
export function withSnippets(href: string, lines: string[]): string {
  const c = parseCitation(href);
  if (!c || c.kind === "codex" || c.q) return href;
  const q = lineSnippet(lines[c.from - 1]);
  if (!q) return href;
  const qe = c.to > c.from ? lineSnippet(lines[c.to - 1]) : undefined;
  // Parentheses would end the markdown link early.
  const enc = (s: string) => encodeURIComponent(s).replace(/[()]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  const path = href.slice(4).split("?", 1)[0];
  return `pen:${path}?q=${enc(q)}${qe ? `&qe=${enc(qe)}` : ""}`;
}
