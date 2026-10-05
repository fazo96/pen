import type { Editor } from "@tiptap/react";

// The page around the text is wider and taller than the editor: on a short
// document most of the screen is page, not editor, and a click there would do
// nothing. Pages call this on mousedown (clicks and taps, never touch scrolls).

/**
 * A click on the editor's surroundings (the page or any box holding the
 * editor, not text, toolbars or banners) focuses the editor: at the end below
 * the text, else at the nearest spot on the line clicked beside.
 */
export function focusFromMargin(editor: Editor | null, e: React.MouseEvent) {
  if (!editor || e.button !== 0 || e.defaultPrevented) return;
  const view = editor.view;
  const target = e.target as Element;
  if (!(target instanceof Element) || !target.contains(view.dom) || !e.currentTarget.contains(target)) return;
  e.preventDefault(); // else the browser focuses nothing (or the page)
  const box = view.dom.getBoundingClientRect();
  if (e.clientY >= box.bottom) {
    editor.commands.focus("end");
    return;
  }
  const inside = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo + 1), hi - 1);
  const at = view.posAtCoords({ left: inside(e.clientX, box.left, box.right), top: inside(e.clientY, box.top, box.bottom) });
  if (at) editor.chain().focus().setTextSelection(at.pos).run();
  else editor.commands.focus("end");
}
