import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { critsTitle, critsToMarkdown, isCritiqueCirclePage, parseCritPage } from "../lib/critiquecircle.ts";

// An anonymized saved page: real Critique Circle markup, invented story, critters and ids.
const html = readFileSync(new URL("fixtures/critiquecircle.html", import.meta.url), "utf8");
const expected = readFileSync(new URL("fixtures/critiquecircle.md", import.meta.url), "utf8");

const page = (body: string) =>
  `<h1 class="storytitle"><a>Story - Part 1 of 2</a></h1>${body}`;
const crit = (para: string, author: string, body: string) =>
  `<div class="comment col_1" data-para="${para}"><h4><a>${author}</a> <i class="fa fa-badge"></i></h4>${body}</div>`;

test("converts the saved page to the expected markdown", () => {
  assert.equal(critsToMarkdown(html).markdown, expected);
});

test("recognises Critique Circle pages", () => {
  assert.equal(isCritiqueCirclePage(html), true);
  assert.equal(isCritiqueCirclePage("<html><body><p>Hello</p></body></html>"), false);
  assert.equal(isCritiqueCirclePage('<h1 class="storytitle"><a>No crits yet</a></h1>'), false);
});

test("titles the entry after the part", () => {
  assert.equal(critsToMarkdown(html).title, "Crits: Part 2 of 3");
  assert.equal(critsTitle("Salt and Signal - Part 5 of 8"), "Crits: Part 5 of 8");
  assert.equal(critsTitle("A Standalone Story"), "Crits: A Standalone Story");
  assert.equal(critsTitle(""), "Crits: Critique Circle");
});

test("attaches every crit to its paragraph, in order", () => {
  const p = parseCritPage(html);
  assert.equal(p.title, "The Lamplighter's Debt - Part 2 of 3");
  assert.deepEqual(
    p.opening.map((c) => c.author),
    ["Quillfeather", "Marlowe_T"],
  );
  assert.deepEqual(
    p.story.map((s) => [s.lines.join(" | "), s.crits.map((c) => c.author)]),
    [
      ["○", []],
      ["Tides", ["Quillfeather"]],
      [
        "The lamp had gone out at midnight, and Oren climbed the stairs with a candle between his teeth.",
        ["Marlowe_T", "Inkwell42"],
      ],
      ["Salt crusted the railing. He did not look down.", []],
      ["*Keeper's log, day forty:* the fog **will** lift.", ["Inkwell42"]],
      ["- Who's there? he called.", ["Quillfeather"]],
    ],
  );
  assert.deepEqual(
    p.closing.map((c) => c.author),
    ["Quillfeather", "Marlowe_T"],
  );
});

test("ignores markup inside scripts and the page chrome", () => {
  const md = critsToMarkdown(html).markdown;
  assert.doesNotMatch(md, /Ghost|not a crit|Back to top|Mark comment done/);
});

test("keeps a crit's paragraphs, quotes and line breaks apart", () => {
  const [c] = parseCritPage(page(crit("start", "A", "<p><q>quoted</q> </p><p>Why?</p><p>One<br>Two</p>"))).opening;
  assert.deepEqual(c.paragraphs, ['"quoted"', "Why?", "One", "Two"]);
});

test("emphasis hugs its text and empty emphasis disappears", () => {
  const [c] = parseCritPage(
    page(crit("start", "A", "<p>a<em> b </em>c <strong></strong>d <em>e</em>, <b>f</b></p>")),
  ).opening;
  assert.deepEqual(c.paragraphs, ["a *b* c d *e*, **f**"]);
});

test("escapes text markdown or pen comments would read as syntax", () => {
  const md = critsToMarkdown(
    page(
      '<div class="st" data-para="x1"><p># not a heading</p><p>> nor a quote</p><p>3. nor a list</p></div>' +
        crit("x1", "Some_One", "<p>*stars* and [links](x) and <code>&lt;tags&gt;</code> and %% no comment %%</p><p>- dash</p>"),
    ),
  ).markdown;
  assert.match(md, /^> \\# not a heading\n>\n> \\> nor a quote\n>\n> 3\\\. nor a list$/m);
  assert.match(md, /^\*\*Some\\_One\*\*: \\\*stars\\\* and \\\[links\\\]\(x\) and \\<tags> and %\\% no comment %\\%$/m);
  assert.match(md, /^\\- dash$/m);
});

test("leaves harmless line starts alone", () => {
  const md = critsToMarkdown(page(crit("end", "A", "<p>1. first</p><p>1.Yes</p><p>#hashtag</p>"))).markdown;
  assert.match(md, /^\*\*A\*\*: 1\. first$/m);
  assert.match(md, /^1\.Yes$/m);
  assert.match(md, /^#hashtag$/m);
});

test("drops crits on paragraphs that aren't on the page and names anonymous critters", () => {
  const md = critsToMarkdown(page(crit("gone", "A", "<p>lost</p>") + crit("start", "", "<p>hi</p>"))).markdown;
  assert.doesNotMatch(md, /lost/);
  assert.match(md, /^\*\*Anonymous\*\*: hi$/m);
});
