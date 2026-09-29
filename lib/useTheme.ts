"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "auto" | "light" | "dark";
export const THEME_LABEL: Record<Theme, string> = { auto: "Auto", light: "Paper", dark: "Night" };

// <html data-theme> is the source of truth, so several controls stay in step.
function current(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "auto";
}

/** The theme set on <html> (and remembered in localStorage), cycled auto → paper → night. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("auto");

  useEffect(() => setTheme(current()), []);

  const cycle = useCallback(() => {
    const now = current();
    const next: Theme = now === "auto" ? "light" : now === "light" ? "dark" : "auto";
    setTheme(next);
    const root = document.documentElement;
    try {
      if (next === "auto") {
        delete root.dataset.theme;
        localStorage.removeItem("pen:theme");
      } else {
        root.dataset.theme = next;
        localStorage.setItem("pen:theme", next);
      }
    } catch {}
  }, []);

  return { theme, label: THEME_LABEL[theme], cycle };
}
