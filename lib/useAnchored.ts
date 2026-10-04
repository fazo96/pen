"use client";

import type { Editor } from "@tiptap/react";
import { type RefObject, useEffect, useEffectEvent, useLayoutEffect, useState } from "react";

type Range = { from: number; to: number };

/**
 * Where to put a floating box by a range of the editor: under it (or over it,
 * with `above`), flipped when there's no room, kept on screen, and followed
 * through scrolling and the phone keyboard. `onOutside` runs on a press
 * outside both the box and the editor.
 */
export function useAnchored(
  editor: Editor,
  range: Range | null,
  box: RefObject<HTMLElement | null>,
  { above = false, onOutside }: { above?: boolean; onOutside?: () => void } = {},
): { left: number; top: number } | null {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!range) return setPos(null);
    const place = () => {
      const el = box.current;
      if (!el || editor.isDestroyed || range.to > editor.state.doc.content.size) return;
      const start = editor.view.coordsAtPos(range.from);
      const end = editor.view.coordsAtPos(range.to, -1);
      const vv = window.visualViewport;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.max(8, Math.min(start.left, window.innerWidth - w - 8));
      const over = start.top - h - 6;
      const under = end.bottom + 6;
      const fitsOver = over > 8;
      const fitsUnder = under + h < bottom - 8;
      setPos({ left, top: above ? (fitsOver || !fitsUnder ? over : under) : fitsUnder || !fitsOver ? under : over });
    };
    place();
    let frame = 0;
    const onMove = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !editor.view.dom.contains(t)) onOutside?.();
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    window.visualViewport?.addEventListener("resize", onMove);
    document.addEventListener("pointerdown", onDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      window.visualViewport?.removeEventListener("resize", onMove);
      document.removeEventListener("pointerdown", onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range?.from, range?.to, editor, above]);

  return range ? pos : null;
}

/** A popover over the text closes when the document changes (typing elsewhere, the words moved) or on Escape. */
export function useCloseOnEdit(editor: Editor, close: () => void) {
  const onClose = useEffectEvent(close);
  useEffect(() => {
    const onTx = ({ transaction }: { transaction: { docChanged: boolean } }) => transaction.docChanged && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    editor.on("transaction", onTx);
    window.addEventListener("keydown", onKey);
    return () => {
      editor.off("transaction", onTx);
      window.removeEventListener("keydown", onKey);
    };
  }, [editor]);
}
