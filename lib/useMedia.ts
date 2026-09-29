"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Whether a media query matches; null until hydrated, so effects can tell "not yet known" from "no". */
export function useMedia(query: string): boolean | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => null,
  );
}
