"use client";

import { useSyncExternalStore } from "react";
import { isMac, keyLabel, type ShortcutId, withKeys } from "./shortcuts";

const noop = () => () => {};

/** Shortcut labels for this device; Ctrl+… while server-rendering, ⌘ on a Mac once hydrated. */
export function useKeys() {
  const mac = useSyncExternalStore(noop, isMac, () => false);
  return {
    key: (id: ShortcutId) => keyLabel(id, mac),
    title: (label: string, id: ShortcutId) => withKeys(label, id, mac),
  };
}
