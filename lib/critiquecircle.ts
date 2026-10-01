import { Parser } from "htmlparser2";

// Crits from a saved Critique Circle story page, as a Codex entry.
//
// The page holds the story as `div.st[data-para=<hash>]`, one per paragraph,
// with the crits on it nested inside as `div.comment[data-para=<same hash>]`
// (author in `h4 > a`, body in `<p>`s). Opening and closing comments carry
// data-para "start" and "end". The title is `h1.storytitle > a`.
//
// Kept self-contained (no pen imports) so tests can load it with plain Node.

export type Crit = { author: string; paragraphs: string[] };
export type CritPage = {
  title: string;
  opening: Crit[];
  story: { lines: string[]; crits: Crit[] }[];
  closing: Crit[];
};

/** Whether this looks like a saved Critique Circle story page with crits. */
export function isCritiqueCirclePage(html: string): boolean {
  return /class="storytitle"/.test(html) && /class="comment\b[^"]*"[^>]*data-para=/.test(html);
}

// Characters markdown (or pen's %% comments) would read as syntax.
function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]<]/g, "\\$&").replace(/%%/g, "%\\%");
}

// A line that would start a heading, quote, list or rule.
function escapeLineStart(line: string): string {
  return line.replace(/^(\s*)(>|(?:[#+=-]|\d+[.)])(?=\s|$))/, (_m, ws: string, mark: string) =>
    mark.length > 1 ? `${ws}${mark.slice(0, -1)}\\${mark.slice(-1)}` : `${ws}\\${mark}`,
  );
}

const MARKS: Record<string, string> = { em: "*", i: "*", strong: "**", b: "**" };
const BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre"]);

/**
 * Collects inline text as markdown, one entry per block (line starts left unescaped). Emphasis markers hug
 * their text: whitespace at their edges moves outside, and empty ones vanish.
 */
class Inline {
  blocks: string[] = [];
  private cur = "";
  private pending = ""; // opening markers not yet followed by text

  text(raw: string) {
    const text = raw.replace(/\s+/g, " ");
    if (!text.trim()) {
      if (!this.pending && this.cur && !this.cur.endsWith(" ")) this.cur += " ";
      return;
    }
    const lead = text.match(/^\s*/)![0];
    if (lead && this.cur && !this.cur.endsWith(" ")) this.cur += " ";
    this.cur += this.pending + escapeInline(text.slice(lead.length));
    this.pending = "";
  }

  open(mark: string) {
    this.pending += mark;
  }

  close(mark: string) {
    if (this.pending.endsWith(mark)) {
      this.pending = this.pending.slice(0, -mark.length);
      return;
    }
    const trail = this.cur.match(/\s*$/)![0];
    this.cur = this.cur.slice(0, this.cur.length - trail.length) + mark + trail;
  }

  /** A literal (already markdown) piece, e.g. a quote mark. */
  raw(s: string) {
    this.cur += this.pending + s;
    this.pending = "";
  }

  break() {
    this.pending = "";
    const block = this.cur.trim();
    if (block) this.blocks.push(block);
    this.cur = "";
  }
}

type Frame = { tag: string; kind?: "crit" | "story" };

/** Parse the page into its title, opening/closing comments and paragraphs with their crits. */
export function parseCritPage(html: string): CritPage {
  const page: CritPage = { title: "", opening: [], story: [], closing: [] };
  const stack: Frame[] = [];

  let inTitle = 0; // depth inside h1.storytitle
  let titleText = "";

  let crit: { para: string; author: string; body: Inline; inH4: boolean } | null = null;
  let story: { para: string; body: Inline } | null = null;
  const storyIndex = new Map<string, number>();
  const pendingCrits = new Map<string, Crit[]>(); // crits whose paragraph hasn't closed yet

  const inline = () => (crit ? crit.body : story?.body);

  const parser = new Parser(
    {
      onopentag(tag, attrs) {
        const frame: Frame = { tag };
        const cls = (attrs.class ?? "").split(/\s+/);
        const para = attrs["data-para"];
        if (tag === "h1" && cls.includes("storytitle")) inTitle = 1;
        else if (inTitle) inTitle++;

        if (tag === "div" && para && cls.includes("comment") && !crit) {
          crit = { para, author: "", body: new Inline(), inH4: false };
          frame.kind = "crit";
        } else if (tag === "div" && para && cls.includes("st") && !story && !crit && para !== "start" && para !== "end") {
          story = { para, body: new Inline() };
          frame.kind = "story";
        } else if (tag === "h4" && crit) {
          crit.inH4 = true;
        } else if (tag === "br") {
          inline()?.break();
        } else if (BLOCKS.has(tag)) {
          inline()?.break();
        } else if (tag === "q") {
          inline()?.raw('"');
        } else if (MARKS[tag]) {
          inline()?.open(MARKS[tag]);
        }
        stack.push(frame);
      },

      ontext(text) {
        if (inTitle) titleText += text;
        if (crit) {
          if (crit.inH4) {
            // The author's name; badges in the h4 are icons without text.
            if (stack.some((f) => f.tag === "a")) crit.author += text;
          } else crit.body.text(text);
        } else if (story) story.body.text(text);
      },

      onclosetag(tag) {
        // htmlparser2 closes implied/unclosed tags in order, so the stack stays in sync.
        const frame = stack.pop();
        if (inTitle) inTitle--;
        if (frame?.kind === "crit" && crit) {
          crit.body.break();
          const author = crit.author.replace(/\s+/g, " ").trim();
          const paragraphs = crit.body.blocks;
          if (author || paragraphs.length) {
            const list = pendingCrits.get(crit.para) ?? [];
            list.push({ author, paragraphs });
            pendingCrits.set(crit.para, list);
          }
          crit = null;
        } else if (frame?.kind === "story" && story) {
          story.body.break();
          storyIndex.set(story.para, page.story.length);
          page.story.push({ lines: story.body.blocks, crits: [] });
          story = null;
        } else if (tag === "h4" && crit) {
          crit.inH4 = false;
        } else if (BLOCKS.has(tag)) {
          inline()?.break();
        } else if (tag === "q") {
          inline()?.raw('"');
        } else if (MARKS[tag]) {
          inline()?.close(MARKS[tag]);
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );
  parser.write(html);
  parser.end();

  page.title = titleText.replace(/\s+/g, " ").trim();
  for (const [para, crits] of pendingCrits) {
    if (para === "start") page.opening.push(...crits);
    else if (para === "end") page.closing.push(...crits);
    else {
      const i = storyIndex.get(para);
      if (i !== undefined) page.story[i].crits.push(...crits);
    }
  }
  return page;
}

/** "Salt and Signal - Part 5 of 8" → "Crits: Part 5 of 8"; other titles stay whole. */
export function critsTitle(storyTitle: string): string {
  const part = storyTitle.match(/\bPart\s+\d+(?:\s+of\s+\d+)?\s*$/i);
  return `Crits: ${part ? part[0].trim() : storyTitle || "Critique Circle"}`;
}

function critMarkdown(c: Crit): string {
  const [first = "", ...rest] = c.paragraphs;
  return [`**${escapeInline(c.author || "Anonymous")}**: ${first}`, ...rest.map(escapeLineStart)].join("\n\n");
}

/** The whole page as a Codex entry. */
export function critsToMarkdown(html: string): { title: string; markdown: string } {
  const page = parseCritPage(html);
  const title = critsTitle(page.title);
  const out: string[] = [`# ${escapeInline(title)}`];
  if (page.title) out.push(`Crits on *${escapeInline(page.title)}* from Critique Circle.`);

  out.push("## Opening comments", ...page.opening.map(critMarkdown));
  out.push("## Story");
  for (const p of page.story) {
    if (!p.lines.length && !p.crits.length) continue;
    if (p.lines.length) out.push(p.lines.map((l) => `> ${escapeLineStart(l)}`).join("\n>\n"));
    out.push(...p.crits.map(critMarkdown));
  }
  out.push("## Closing comments", ...page.closing.map(critMarkdown));
  return { title, markdown: out.join("\n\n") + "\n" };
}
