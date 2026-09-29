"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "pen:focus";
const REVEAL_PX = 90; // pointer this close to the bottom edge reveals the toolbar
const HIDE_DELAY_MS = 800;

/**
 * Focus mode hides everything but the manuscript. The flag lives on <html>
 * (set before paint by the layout script) so a reload never flashes chrome.
 */
export function useFocusMode() {
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false); // toolbar kept open via the corner button
  const [peek, setPeek] = useState(false); // toolbar revealed by the pointer
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // After "hide toolbar", ignore the reveal zone until the pointer leaves it.
  const suppressed = useRef(false);

  useEffect(() => {
    setFocus("focus" in document.documentElement.dataset);
  }, []);

  const set = useCallback((on: boolean) => {
    setFocus(on);
    setPinned(false);
    setPeek(false);
    const root = document.documentElement;
    if (on) root.dataset.focus = "";
    else delete root.dataset.focus;
    try {
      if (on) localStorage.setItem(KEY, "1");
      else localStorage.removeItem(KEY);
    } catch {}
  }, []);

  const toggle = useCallback(() => set(!("focus" in document.documentElement.dataset)), [set]);

  // Esc leaves, Ctrl/⌘+Shift+F toggles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        toggle();
      } else if (e.key === "Escape" && "focus" in document.documentElement.dataset) {
        set(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [set, toggle]);

  // Reveal the toolbar while the pointer is near the bottom edge.
  useEffect(() => {
    if (!focus) return;
    const onMove = (e: MouseEvent) => {
      const inZone = e.clientY >= window.innerHeight - REVEAL_PX;
      if (!inZone) suppressed.current = false;
      if (inZone && !suppressed.current) {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = null;
        setPeek(true);
      } else if (!inZone && !hideTimer.current) {
        hideTimer.current = setTimeout(() => {
          hideTimer.current = null;
          setPeek(false);
        }, HIDE_DELAY_MS);
      }
    };
    const onLeave = () => setPeek(false);
    window.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = null;
    };
  }, [focus]);

  return {
    focus,
    toggle,
    exit: () => set(false),
    toolbarShown: pinned || peek,
    pinned,
    togglePinned: () => {
      if (pinned) {
        suppressed.current = true;
        setPeek(false);
      }
      setPinned(!pinned);
    },
  };
}
