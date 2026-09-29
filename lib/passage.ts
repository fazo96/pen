import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

// Showing a passage Construct cited (see lib/cite.ts): scroll to it and mark
// its paragraphs for a moment. The mark is a decoration, since ProseMirror
// redraws nodes and would drop a class set on their DOM.

const key = new PluginKey<DecorationSet>("citedPassage");
const SHOW_MS = 2600;

/** Holds the highlight; set with showPassage. */
export const CitedPassage = Extension.create({
  name: "citedPassage",
  addProseMirrorPlugins: () => [
    new Plugin<DecorationSet>({
      key,
      state: {
        init: () => DecorationSet.empty,
        apply: (tr, set) => tr.getMeta(key) ?? set.map(tr.mapping, tr.doc),
      },
      props: { decorations: (state) => key.getState(state) },
    }),
  ],
});

let clear: ReturnType<typeof setTimeout> | undefined;

/** Scrolls a found passage into view and highlights it for a moment. */
export function showPassage(view: EditorView, range: { from: number; to: number }) {
  const decos: Decoration[] = [];
  view.state.doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (!node.isTextblock) return true;
    decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "is-cited" }));
    return false;
  });
  // Cleared first, so a second click on the same chip restarts the animation.
  view.dispatch(view.state.tr.setMeta(key, DecorationSet.empty));
  requestAnimationFrame(() => {
    if (view.isDestroyed) return;
    view.dispatch(view.state.tr.setMeta(key, DecorationSet.create(view.state.doc, decos)));
    const el = view.nodeDOM(range.from);
    if (el instanceof HTMLElement) {
      window.scrollBy({ top: el.getBoundingClientRect().top - window.innerHeight * 0.3, behavior: "smooth" });
    }
  });
  clearTimeout(clear);
  clear = setTimeout(() => {
    if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, DecorationSet.empty));
  }, SHOW_MS);
}
