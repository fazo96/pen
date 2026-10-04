"use client";

import { Marked } from "marked";
import { useMemo } from "react";
import { parseCitation } from "@/lib/cite";

// Construct's replies (and quick answers) as markdown.

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Agent replies are markdown. Raw HTML is shown as text; only web links link.
const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    image: ({ text }) => escapeHtml(text),
    link({ href, tokens }) {
      const inner = this.parser.parseInline(tokens);
      // Citations (see lib/cite.ts) become chips; the log handles their clicks.
      const cite = parseCitation(href);
      if (cite) {
        const quote = cite.kind !== "codex" && cite.q ? ` title="${escapeHtml(`“${cite.q}…”`)}"` : "";
        return `<button type="button" class="cite is-${cite.kind}" data-cite="${escapeHtml(href)}"${quote}>${inner}</button>`;
      }
      return /^https?:\/\//i.test(href)
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${inner}</a>`
        : inner;
    },
  },
});

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => md.parse(text, { async: false }), [text]);
  return <div className="construct-md" dangerouslySetInnerHTML={{ __html: html }} />;
}
