import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { type FindOptions, findBlocks, MAX_MATCHES, matchFrom, type Range, search } from "./find";

// Find and replace, the editor half: the matches drawn as decorations, the
// current one stronger. Edits move them along at once and search again once
// typing pauses (a long book takes a few milliseconds to read through).

export type FindState = {
  query: string;
  options: FindOptions;
  matches: Range[];
  /** More than MAX_MATCHES were found; the rest aren't drawn. */
  more: boolean;
  /** Index into `matches`, -1 for none. */
  current: number;
  /** Matches, without the current one. */
  base: DecorationSet;
  decos: DecorationSet;
  /** The document changed since the last search. */
  stale: boolean;
};

type Meta =
  | { search: { query: string; options: FindOptions }; from?: number }
  | { refresh: true }
  | { current: number }
  | { clear: true };

export const findKey = new PluginKey<FindState>("find");
const REFRESH_MS = 250;

const EMPTY: FindState = {
  query: "",
  options: { caseSensitive: false, wholeWord: false },
  matches: [],
  more: false,
  current: -1,
  base: DecorationSet.empty,
  decos: DecorationSet.empty,
  stale: false,
};

function withCurrent(s: Omit<FindState, "decos">, doc: EditorState["doc"]): FindState {
  const m = s.matches[s.current];
  const decos = m ? s.base.add(doc, [Decoration.inline(m.from, m.to, { class: "find-current" })]) : s.base;
  return { ...s, decos };
}

/** Searches afresh, keeping the current match near `near` (the old one's place, or the cursor). */
function searched(query: string, options: FindOptions, doc: EditorState["doc"], near: number): FindState {
  const found = search(findBlocks(doc), query, options);
  const matches = found.slice(0, MAX_MATCHES);
  const more = found.length > MAX_MATCHES;
  const base = DecorationSet.create(
    doc,
    matches.map((m) => Decoration.inline(m.from, m.to, { class: "find-match" })),
  );
  return withCurrent({ query, options, matches, more, current: matchFrom(matches, near), base, stale: false }, doc);
}

function apply(tr: Transaction, prev: FindState, _old: EditorState, state: EditorState): FindState {
  const meta = tr.getMeta(findKey) as Meta | undefined;
  if (meta && "clear" in meta) return EMPTY;
  if (meta && "search" in meta) {
    return searched(meta.search.query, meta.search.options, tr.doc, meta.from ?? state.selection.from);
  }
  if (!prev.query) return prev;
  if (meta && "refresh" in meta) {
    const near = prev.matches[prev.current]?.from ?? state.selection.from;
    return searched(prev.query, prev.options, tr.doc, near);
  }
  if (meta && "current" in meta) return withCurrent({ ...prev, current: meta.current }, tr.doc);
  if (!tr.docChanged) return prev;
  // Moved along now, searched again in a moment.
  const matches = prev.matches
    .map((m) => ({ from: tr.mapping.map(m.from, 1), to: tr.mapping.map(m.to, -1) }))
    .filter((m) => m.to > m.from);
  const current = Math.min(prev.current, matches.length - 1);
  return withCurrent({ ...prev, matches, current, base: prev.base.map(tr.mapping, tr.doc), stale: true }, tr.doc);
}

export const Find = Extension.create({
  name: "find",
  addProseMirrorPlugins: () => [
    new Plugin<FindState>({
      key: findKey,
      state: { init: () => EMPTY, apply },
      view: () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        return {
          update: (view) => {
            if (!findKey.getState(view.state)!.stale) return;
            clearTimeout(timer);
            timer = setTimeout(() => {
              if (!view.isDestroyed && findKey.getState(view.state)!.stale) dispatch(view, { refresh: true });
            }, REFRESH_MS);
          },
          destroy: () => clearTimeout(timer),
        };
      },
      props: { decorations: (state) => findKey.getState(state)!.decos },
    }),
  ],
});

const dispatch = (view: EditorView, meta: Meta, tr = view.state.tr) =>
  view.dispatch(tr.setMeta(findKey, meta).setMeta("addToHistory", false));

export const findState = (state: EditorState) => findKey.getState(state) ?? EMPTY;

/** Search for `query` (empty clears the highlights), starting from the cursor. */
export function setSearch(view: EditorView, query: string, options: FindOptions) {
  dispatch(view, { search: { query, options } });
  reveal(view);
}

/** After an edit, search first, so a step or a replace acts on what's really there. */
function fresh(view: EditorView) {
  if (findState(view.state).stale) dispatch(view, { refresh: true });
}

export function clearSearch(view: EditorView) {
  if (findKey.getState(view.state)?.query) dispatch(view, { clear: true });
}

/** The next (1) or previous (-1) match, wrapping round. */
export function step(view: EditorView, dir: 1 | -1) {
  fresh(view);
  const { matches, current } = findState(view.state);
  if (!matches.length) return;
  dispatch(view, { current: current < 0 ? 0 : (current + dir + matches.length) % matches.length });
  reveal(view);
}

/** Replaces the current match and moves to the next one. */
export function replaceCurrent(view: EditorView, text: string) {
  fresh(view);
  const s = findState(view.state);
  const m = s.matches[s.current];
  if (!m) return;
  const tr = view.state.tr;
  if (text) tr.insertText(text, m.from, m.to);
  else tr.delete(m.from, m.to);
  view.dispatch(tr);
  // Searched again at once, from just past the replacement (which may itself match).
  dispatch(view, { search: { query: s.query, options: s.options }, from: m.from + text.length });
  reveal(view);
}

/** Replaces every match in one step (one undo); returns how many. */
export function replaceAll(view: EditorView, text: string): number {
  const s = findState(view.state);
  const matches = search(findBlocks(view.state.doc), s.query, s.options, Infinity);
  if (!matches.length) return 0;
  const tr = view.state.tr;
  for (let i = matches.length - 1; i >= 0; i--) {
    const { from, to } = matches[i];
    if (text) tr.insertText(text, from, to);
    else tr.delete(from, to);
  }
  view.dispatch(tr);
  dispatch(view, { refresh: true });
  return matches.length;
}

/** Closing: the current match becomes the selection, so the cursor is where the search was. */
export function selectCurrent(view: EditorView) {
  const s = findState(view.state);
  const m = s.matches[s.current];
  const tr = view.state.tr;
  if (m && !s.stale) tr.setSelection(TextSelection.create(tr.doc, m.from, m.to));
  dispatch(view, { clear: true }, tr);
}

/** Scrolls the current match to the middle of whatever scrolls it (the page or the Codex panel). */
function reveal(view: EditorView) {
  requestAnimationFrame(() => {
    if (view.isDestroyed) return;
    const el = view.dom.querySelector(".find-current");
    if (!(el instanceof HTMLElement)) return;
    const r = el.getBoundingClientRect();
    const vh = window.visualViewport?.height ?? window.innerHeight;
    if (r.top > vh * 0.15 && r.bottom < vh * 0.7) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}
