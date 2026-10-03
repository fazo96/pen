// Small text helpers shared by the server and the browser.

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** Remove %% … %% and <!-- … --> comments. */
export function stripComments(markdown: string): string {
  return markdown.replace(/%%[\s\S]*?%%|<!--[\s\S]*?-->/g, " ");
}

/** Title is the first H1; failing that, the first line of text; failing that, the fallback. */
export function titleOf(source: string, fallback: string): string {
  const markdown = stripComments(source);
  const h1 = markdown.match(/^#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/m);
  if (h1) return stripInline(h1[1]);
  const line = markdown.split("\n").find((l) => l.trim() && !/^(-{3,}|\*{3,}|_{3,})$/.test(l.trim()));
  if (line) {
    const text = stripInline(line.replace(/^\s*(#+|>|[-*+]|\d+\.)\s+/, ""));
    return text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text;
  }
  return fallback;
}

function stripInline(s: string) {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\([!-/:-@[-`{-~])|[*_~`]/g, (_m, escaped?: string) => escaped ?? "") // "\*" stays a "*"
    .replace(/&amp;/g, "&")
    .trim();
}

/** Words in markdown or plain text, not counting comments. */
export function wordCount(text: string): number {
  const m = stripComments(text).match(/[\p{L}\p{N}’'-]*[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu);
  return m ? m.length : 0;
}

/** Standard manuscript format (12pt Courier, double-spaced) runs about 250 words a page. */
export const WORDS_PER_PAGE = 250;
const WORDS_PER_MINUTE = 230;

/** Manuscript pages: at least 1 once there's a word. */
export const pageCount = (words: number) => (words ? Math.max(1, Math.round(words / WORDS_PER_PAGE)) : 0);

/** Minutes to read, at least 1. */
export const readMinutes = (words: number) => Math.max(1, Math.round(words / WORDS_PER_MINUTE));

/** Words and pages, as book cards and versions show them: "12,345 w · 49 p". */
export const wordsPages = (words: number) => `${words.toLocaleString()} w · ${pageCount(words).toLocaleString()} p`;

/** What `wordsPages` abbreviates, for a hover title. */
export const wordsPagesTitle = (words: number) =>
  `${words.toLocaleString()} ${words === 1 ? "word" : "words"}, about ${pageCount(words).toLocaleString()} manuscript ${pageCount(words) === 1 ? "page" : "pages"} (${WORDS_PER_PAGE} words a page)`;

/**
 * Imported text with an H1 at the top: its own if the first line of text (past
 * any comments) is one, otherwise one made from the file name ("Mara Voss.md" →
 * "# Mara Voss").
 */
export function withTitle(text: string, fileName: string): string {
  const body = text.replace(/^\uFEFF/, "");
  if (/^(?:\s|%%[\s\S]*?%%|<!--[\s\S]*?-->)*#[ \t]+\S/.test(body)) return body;
  const title = fileName.replace(/\.[^.]*$/, "").trim() || "Untitled";
  return `# ${title}\n\n${body.replace(/^\s*\n/, "")}`;
}

/** A new manuscript: the title as its H1, escaped so it reads back as typed ("Untitled" if empty). */
export function newManuscript(title: string): string {
  const text = straightQuotes(title).replace(/\s+/g, " ").trim() || "Untitled";
  const escaped = text
    .replace(/[\\`*_[\]~]/g, "\\$&")
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, "&amp;")
    .replace(/<(?=[A-Za-z/!?])/g, "\\<")
    .replace(/%(?=%)/g, "%\\")
    .replace(/#+$/, "\\$&"); // a closing "#" run would be dropped
  return `# ${escaped}\n\n`;
}

/** Curly quotes to straight ones: pen keeps " and ' (see lib/quotes.ts). */
export function straightQuotes(s: string): string {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}
