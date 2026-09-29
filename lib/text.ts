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

/** Title is the first H1; failing that, the first line of text; failing that, the fallback. */
export function titleOf(markdown: string, fallback: string): string {
  const h1 = markdown.match(/^#[ \t]+(.+?)[ \t#]*$/m);
  if (h1) return stripInline(h1[1]);
  const line = markdown.split("\n").find((l) => l.trim() && !/^(-{3,}|\*{3,}|_{3,})$/.test(l.trim()));
  if (line) {
    const text = stripInline(line.replace(/^\s*(#+|>|[-*+]|\d+\.)\s+/, ""));
    return text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text;
  }
  return fallback;
}

function stripInline(s: string) {
  return s.replace(/[*_~`]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
}

export function wordCount(text: string): number {
  const m = text.match(/[\p{L}\p{N}’'-]*[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu);
  return m ? m.length : 0;
}
