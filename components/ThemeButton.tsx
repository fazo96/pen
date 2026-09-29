"use client";

import { useEffect, useState } from "react";
import { IconTheme } from "./icons";

type Theme = "auto" | "light" | "dark";
const LABEL: Record<Theme, string> = { auto: "Auto", light: "Paper", dark: "Night" };

export default function ThemeButton() {
  const [theme, setTheme] = useState<Theme>("auto");

  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setTheme(t === "light" || t === "dark" ? t : "auto");
  }, []);

  const cycle = () => {
    const next: Theme = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto";
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
  };

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={cycle}
      aria-label={`Theme: ${LABEL[theme]}`}
      title={`Theme: ${LABEL[theme]}`}
    >
      <IconTheme />
    </button>
  );
}
