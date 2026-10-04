// Manuscript structure, shared by the outline drawer and Construct's tools.
// H1 = title, H2 = part (roman-numbered), H3 = chapter (numbered straight through).

import { wordCount } from "./text.ts";

const ROMAN: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

export function roman(n: number) {
  let out = "";
  for (const [v, s] of ROMAN) while (n >= v) (out += s), (n -= v);
  return out;
}

export type Section = {
  level: number;
  text: string;
  /** "Part II", "Chapter 3", or "" for the title. */
  label: string;
  /** 1-based line of the heading, and the last line before the next heading of the same or higher rank. */
  line: number;
  end: number;
  /** Words from the heading to `end`, not counting comments. */
  words: number;
};

/** Blank out comments while keeping line breaks, so line numbers still match. */
function blankComments(markdown: string) {
  return markdown.replace(/%%[\s\S]*?%%|<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
}

/** Headings of a markdown manuscript, numbered like the outline, with word counts. */
export function sectionsOf(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const plain = blankComments(markdown).split("\n");
  const found: { level: number; text: string; line: number }[] = [];
  let fence: string | null = null;
  plain.forEach((l, i) => {
    const f = l.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (f) fence = fence ? (f[1][0] === fence[0] ? null : fence) : f[1];
    if (fence) return;
    const h = l.match(/^ {0,3}(#{1,3})[ \t]+(.+?)[ \t#]*$/);
    if (h) found.push({ level: h[1].length, text: h[2].replace(/[*_~`]/g, "").trim(), line: i + 1 });
  });

  let part = 0;
  let chapter = 0;
  return found.map((h, i) => {
    const next = found.slice(i + 1).find((o) => o.level <= h.level);
    const end = next ? next.line - 1 : lines.length;
    const label = h.level === 2 ? `Part ${roman(++part)}` : h.level === 3 ? `Chapter ${++chapter}` : "";
    return { ...h, label, end, words: wordCount(lines.slice(h.line - 1, end).join("\n")) };
  });
}
