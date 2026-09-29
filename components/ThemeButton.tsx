"use client";

import { useTheme } from "@/lib/useTheme";
import { IconTheme } from "./icons";

export default function ThemeButton() {
  const { label, cycle } = useTheme();
  return (
    <button type="button" className="icon-btn" onClick={cycle} aria-label={`Theme: ${label}`} title={`Theme: ${label}`}>
      <IconTheme />
    </button>
  );
}
