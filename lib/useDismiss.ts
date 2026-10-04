"use client";

import { type RefObject, useEffect, useEffectEvent } from "react";

/**
 * While `open`: a press outside `inside` (an element, or a test of the
 * pressed one) or Escape calls `close`. With `escapeFirst`, Escape is caught
 * before anything else on the page sees it, so it closes only this.
 */
export function useDismiss(
  open: boolean,
  inside: RefObject<Element | null> | ((target: Element) => boolean),
  close: () => void,
  { escapeFirst = false }: { escapeFirst?: boolean } = {},
) {
  const onClose = useEffectEvent(close);
  const isInside = useEffectEvent((target: Element) =>
    typeof inside === "function" ? inside(target) : !!inside.current?.contains(target),
  );
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!isInside(e.target as Element)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (escapeFirst) e.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, escapeFirst);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, escapeFirst);
    };
  }, [open, escapeFirst]);
}
