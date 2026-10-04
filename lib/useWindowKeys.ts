"use client";

import { useEffect, useEffectEvent } from "react";

/** Every keydown on the page, before the editor sees it (capture phase); `onKey` can change each render. */
export function useWindowKeys(onKey: (e: KeyboardEvent) => void) {
  const handle = useEffectEvent(onKey);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => handle(e);
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, []);
}
