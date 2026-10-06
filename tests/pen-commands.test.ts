import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCommands, buildPlaces, type CommandsContext, type PlacesContext } from "../lib/penCommands.ts";

// What the editor page's switcher and command palette offer (lib/penCommands.ts).

const noop = () => {};
const shared = {
  projectId: "book",
  isEntry: false,
  here: null,
  panelEntry: null,
  last: null,
  switchLabel: "Codex",
  hint: () => undefined,
};
const entries = [
  { id: "mara", title: "Mara Voss", words: 10, modified: 0 },
  { id: "harbour", title: "The Harbour", words: 5, modified: 0 },
  { id: "rain", title: "Rain", words: 3, modified: 0 },
];
const places = (over: Partial<PlacesContext> = {}) =>
  buildPlaces({
    ...shared,
    recent: [],
    entries,
    books: [
      { id: "book", title: "This Book", words: 1, modified: 0, cover: null },
      { id: "other", title: "Other Book", words: 1, modified: 0, cover: null },
    ],
    headings: [],
    switchView: noop,
    openEntry: noop,
    jumpTo: noop,
    openBook: noop,
    ...over,
  });

test("places number parts, chapters and scenes on the manuscript, not in an entry", () => {
  const headings = [
    { pos: 0, level: 1, text: "Book" },
    { pos: 5, level: 4, text: "Prologue" },
    { pos: 10, level: 2, text: "Arrival" },
    { pos: 20, level: 3, text: "The Harbour" },
    { pos: 25, level: 4, text: "Fog" },
    { pos: 27, level: 4, text: "Bells" },
    { pos: 30, level: 3, text: "" },
    { pos: 35, level: 4, text: "Dawn" },
    { pos: 40, level: 2, text: "Departure" },
  ];
  const rows = places({ headings }).filter((p) => p.section === "Contents");
  assert.deepEqual(
    rows.map((p) => [p.prefix, p.label]),
    [
      [undefined, "Book"],
      ["1", "Prologue"],
      ["Part I", "Arrival"],
      ["01", "The Harbour"],
      ["1.1", "Fog"],
      ["1.2", "Bells"],
      ["02", "Untitled"],
      ["2.1", "Dawn"],
      ["Part II", "Departure"],
    ],
  );
  assert.match(rows[3].keywords!, /chapter 1/);
  assert.match(rows[5].keywords!, /scene 1\.2/);
  const inEntry = places({ isEntry: true, here: "mara", headings });
  assert.ok(inEntry.filter((p) => p.key.startsWith("h:")).every((p) => p.section === "Headings" && !p.prefix));
});

test("places list recent entries first, without the one shown or the switch's target", () => {
  const recent = ["rain", "mara", "gone"];
  // The switch already goes to "rain", the entry viewed last.
  const rows = places({ recent, last: { id: "rain", title: "Rain" } });
  assert.deepEqual(
    rows.filter((p) => p.section === "Recent").map((p) => p.key),
    ["switch", "recent:mara"],
  );
  // The Codex section: the recent ones first, only in search results when listed above.
  const codex = rows.filter((p) => p.section === "Codex");
  assert.deepEqual(
    codex.map((p) => [p.key, p.when]),
    [
      ["codex:rain", "search"],
      ["codex:mara", "search"],
      ["codex:harbour", undefined],
    ],
  );
  // On mara's own page, mara isn't offered.
  assert.ok(!places({ isEntry: true, here: "mara", recent }).some((p) => p.key.endsWith(":mara")));
  // Other books, not this one.
  assert.deepEqual(
    rows.filter((p) => p.section === "Books").map((p) => p.label),
    ["Other Book"],
  );
});

test("place actions open what they name", () => {
  const opened: string[] = [];
  const rows = places({ openEntry: (e) => opened.push(`entry:${e}`), openBook: (b) => opened.push(`book:${b}`) });
  rows.find((p) => p.key === "codex:harbour")!.run!();
  rows.find((p) => p.key === "book:other")!.run!();
  assert.deepEqual(opened, ["entry:harbour", "book:other"]);
});

const run = new Proxy({} as CommandsContext["run"], { get: () => noop });
const commands = (over: Partial<CommandsContext> = {}) =>
  buildCommands({
    ...shared,
    ai: true,
    canFind: true,
    inPanel: false,
    picked: null,
    constructOpen: false,
    grammarOn: false,
    grammarList: true,
    focus: false,
    steady: false,
    nextTheme: "Light",
    run,
    ...over,
  }).map((c) => c.key);

test("commands follow the page: AI, selection, entry page, panel, preview", () => {
  const base = commands();
  assert.ok(base.includes("to-construct") && base.includes("new-chat"));
  assert.ok(!commands({ ai: false }).some((k) => k.includes("construct") || k.includes("chat")));
  assert.ok(!base.includes("lookup"));
  assert.deepEqual(
    commands({ picked: "rain" }).filter((k) => ["lookup", "ask-synonyms", "ask-meaning", "ask"].includes(k)),
    ["lookup", "ask-synonyms", "ask-meaning", "ask"],
  );
  assert.deepEqual(
    commands({ picked: "rain", ai: false }).filter((k) => k.startsWith("ask") || k === "lookup"),
    ["lookup"],
  );
  const entryPage = commands({ isEntry: true, here: "mara" });
  for (const k of ["to-manuscript", "to-codex", "save-version", "history"]) assert.ok(!entryPage.includes(k), k);
  assert.ok(entryPage.includes("switch"));
  assert.ok(!base.includes("switch"));
  assert.ok(!commands({ canFind: false }).includes("find"));
  assert.ok(commands({ panelEntry: { id: "mara", title: "Mara Voss" } }).includes("close-entry"));
  assert.ok(!commands({ isEntry: true, panelEntry: { id: "mara", title: "Mara Voss" } }).includes("close-entry"));
  assert.ok(commands({ grammarOn: true }).includes("grammar-list"));
  assert.ok(!commands({ grammarOn: true, grammarList: false }).includes("grammar-list"));
  assert.ok(commands({ constructOpen: true }).includes("construct"));
});

test("command labels say what they'll do", () => {
  const labels = buildCommands({
    ...shared,
    ai: true,
    canFind: true,
    inPanel: true,
    picked: "rain",
    constructOpen: false,
    grammarOn: true,
    grammarList: true,
    focus: true,
    steady: true,
    nextTheme: "Dark",
    panelEntry: { id: "mara", title: "Mara Voss" },
    run,
  }).map((c) => c.label);
  for (const l of [
    "Find in the entry…",
    "Look up “rain”",
    "Turn grammar check off",
    "Leave focus mode",
    "Turn the typing fade on",
    "Switch theme to Dark",
    "Open “Mara Voss” on its own page",
  ]) {
    assert.ok(labels.includes(l), l);
  }
});

test("in a book, the switcher lists the Global Codex's entries, but not the one shown beside the manuscript", () => {
  const opened: string[] = [];
  const globalEntries = [
    { id: "style", title: "Style Sheet", words: 4, modified: 0 },
    { id: "world", title: "World Rules", words: 4, modified: 0 },
  ];
  const items = places({ globalEntries, globalHere: "world", openGlobalEntry: (eid) => opened.push(eid) });
  const shared = items.filter((i) => i.section === "Global Codex");
  assert.deepEqual(shared.map((i) => i.label), ["Style Sheet"]);
  shared[0].run?.();
  assert.deepEqual(opened, ["style"]);
  // Not on the Global Codex's own page, which gives no way to open them as such.
  assert.equal(places({ globalEntries }).some((i) => i.section === "Global Codex"), false);
});
