import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { grammar } from "./grammarClient";
import { flagRange, textBlocks, type Flag, type PlacedFlag, type TextBlock } from "./grammarText";

// Grammar and spelling flags drawn under the text. Blocks are checked in the
// background (the one with the cursor first) and again a moment after an edit;
// a flag touched by an edit disappears at once. A click on a flag makes it the
// active one, which GrammarPopover shows; GrammarPane lists them all.

export type ActiveFlag = PlacedFlag;
/** Blocks checked so far, out of those in the document; null before the first pass. */
export type Progress = { checked: number; total: number } | null;
type State = { decos: DecorationSet; active: ActiveFlag | null; progress: Progress };
type Meta = { decos?: DecorationSet; active?: ActiveFlag | null; progress?: Progress };

export const grammarKey = new PluginKey<State>("grammar");

const DELAY_EDIT = 700;
const DELAY_START = 1500;
const BATCH = 50;

/** Spelling flags are drawn (and listed) apart from grammar and style. */
export const isSpelling = (f: Flag) => f.kind === "Spelling" || f.kind === "Typo";
const kindClass = (f: Flag) => (isSpelling(f) ? "is-spelling" : "is-grammar");

function decorate(block: TextBlock, flags: Flag[], out: Decoration[]) {
  for (const flag of flags) {
    const r = flagRange(block, flag);
    if (!r) continue;
    out.push(Decoration.inline(r.from, r.to, { class: `grammar-flag ${kindClass(flag)}` }, { flag }));
  }
}

class Checker {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private run = 0;
  private unsubscribe: () => void;
  private onFocus = () => void grammar.refresh();

  constructor(private view: EditorView) {
    this.unsubscribe = grammar.subscribe(() => this.schedule(0));
    window.addEventListener("focus", this.onFocus);
    this.schedule(DELAY_START);
  }

  schedule(ms: number) {
    clearTimeout(this.timer);
    this.run++;
    this.timer = setTimeout(() => void this.check(this.run), ms);
  }

  private dispatch(meta: Meta) {
    if (this.view.isDestroyed) return;
    this.view.dispatch(this.view.state.tr.setMeta(grammarKey, meta).setMeta("addToHistory", false));
  }

  private async check(run: number) {
    if (!grammar.enabled) {
      // Also resets spellcheck.
      this.dispatch({ decos: DecorationSet.empty, active: null, progress: null });
      return;
    }
    while (run === this.run && !this.view.isDestroyed) {
      const { state } = this.view;
      const decos: Decoration[] = [];
      const missing: TextBlock[] = [];
      const blocks = textBlocks(state.doc);
      for (const block of blocks) {
        const flags = grammar.cached(block.text);
        if (flags) decorate(block, flags, decos);
        else missing.push(block);
      }
      // Keep what's shown for blocks still waiting, so nothing flickers.
      const old = grammarKey.getState(state)!.decos;
      for (const b of missing) decos.push(...old.find(b.pos, b.at[b.at.length - 1] + 1));
      this.dispatch({
        decos: DecorationSet.create(state.doc, decos),
        progress: { checked: blocks.length - missing.length, total: blocks.length },
      });
      if (!missing.length) return;

      const head = state.selection.head;
      missing.sort((a, b) => Math.abs(a.pos - head) - Math.abs(b.pos - head));
      const texts = [...new Set(missing.slice(0, BATCH).map((b) => b.text))];
      if (!(await grammar.check(texts))) return;
    }
  }

  destroy() {
    clearTimeout(this.timer);
    this.run++;
    this.unsubscribe();
    window.removeEventListener("focus", this.onFocus);
  }
}

/** Every flag in the document, in order. */
export function grammarFlags(state: EditorState): PlacedFlag[] {
  return grammarKey
    .getState(state)!
    .decos.find()
    .map((d) => ({ from: d.from, to: d.to, flag: (d.spec as { flag: Flag }).flag }))
    .sort((a, b) => a.from - b.from);
}

export function grammarProgress(state: EditorState): Progress {
  return grammarKey.getState(state)!.progress;
}

/** Select a flag, bring it to the middle of the screen, and open its popover. */
export function showFlag(view: EditorView, item: PlacedFlag) {
  const { doc } = view.state;
  if (item.to > doc.content.size) return;
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(doc, item.from, item.to))
      .setMeta(grammarKey, { active: item } satisfies Meta)
      .setMeta("addToHistory", false),
  );
  const top = view.coordsAtPos(item.from).top;
  window.scrollBy({ top: top - window.innerHeight * 0.4, behavior: "smooth" });
}

function flagAt(state: EditorState, pos: number): ActiveFlag | null {
  const found = grammarKey.getState(state)!.decos.find(pos, pos);
  const d = found.find((d) => d.from <= pos && pos <= d.to);
  return d ? { from: d.from, to: d.to, flag: (d.spec as { flag: Flag }).flag } : null;
}

function setActive(view: EditorView, active: ActiveFlag | null) {
  const now = grammarKey.getState(view.state)!.active;
  if (now === active || (now && active && now.from === active.from && now.to === active.to)) return;
  view.dispatch(view.state.tr.setMeta(grammarKey, { active } satisfies Meta).setMeta("addToHistory", false));
}

/** Drops flags an edit touched, and the popover with them. */
function applyTr(tr: Transaction, prev: State): State {
  const meta = tr.getMeta(grammarKey) as Meta | undefined;
  let decos = meta?.decos ?? prev.decos;
  let active = meta && "active" in meta ? meta.active! : prev.active;
  const progress = meta && "progress" in meta ? meta.progress! : prev.progress;
  if (tr.docChanged) {
    if (!meta?.decos) {
      decos = decos.map(tr.mapping, tr.doc);
      const touched: Decoration[] = [];
      tr.mapping.maps.forEach((map, i) => {
        const rest = tr.mapping.slice(i + 1);
        map.forEach((_a, _b, from, to) => touched.push(...decos.find(rest.map(from, -1), rest.map(to, 1))));
      });
      if (touched.length) decos = decos.remove(touched);
    }
    active = null;
  }
  return { decos, active, progress };
}

export const Grammar = Extension.create({
  name: "grammar",

  addProseMirrorPlugins() {
    let checker: Checker | null = null;
    return [
      new Plugin<State>({
        key: grammarKey,
        state: {
          init: () => ({ decos: DecorationSet.empty, active: null, progress: null }),
          apply: applyTr,
        },
        view: (view) => {
          checker = new Checker(view);
          return {
            update: (v, prevState) => {
              if (v.state.doc !== prevState.doc) checker!.schedule(DELAY_EDIT);
            },
            destroy: () => checker!.destroy(),
          };
        },
        props: {
          decorations: (state) => grammarKey.getState(state)!.decos,
          // With the checker on, the browser's own spell check would only double up.
          attributes: (): Record<string, string> => ({ spellcheck: grammar.enabled ? "false" : "true" }),
          handleClick: (view, pos) => {
            setActive(view, grammar.enabled ? flagAt(view.state, pos) : null);
            return false;
          },
          handleDOMEvents: {
            contextmenu: (view, e) => {
              const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
              const found = at && grammar.enabled ? flagAt(view.state, at.pos) : null;
              if (!found) return false;
              e.preventDefault();
              setActive(view, found);
              return true;
            },
            keydown: (view, e) => {
              if (e.key !== "Escape" || !grammarKey.getState(view.state)!.active) return false;
              setActive(view, null);
              return true;
            },
          },
        },
      }),
    ];
  },
});
