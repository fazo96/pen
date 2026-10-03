"use client";

import { useSyncExternalStore } from "react";

// Steady chrome: the top bar, outline and Codex panel stay put while typing
// instead of fading. Per device, in localStorage; <html data-steady> is the
// source of truth, set before paint by the script in app/layout.tsx.

const KEY = "pen:steady";
const listeners = new Set<() => void>();

const isSteady = () => "steady" in document.documentElement.dataset;

export function setSteady(on: boolean) {
  const root = document.documentElement;
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {}
  if (on) root.dataset.steady = "";
  else delete root.dataset.steady;
  listeners.forEach((l) => l());
}

/** Whether the typing fade is off on this device. */
export function useSteady(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    isSteady,
    () => false,
  );
}
