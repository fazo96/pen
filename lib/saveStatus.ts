// What the save status says when it's opened (components/SaveStatus.tsx):
// the state in a sentence, and when this device last saved and last reached
// the server. Pure, so tests load it with plain Node.

import type { SaveStatus } from "./useAutosave";

export const STATUS_EXPLAINED: Record<SaveStatus, string> = {
  saved: "All saved.",
  unsaved: "Saves when you pause typing.",
  saving: "Saving…",
  offline:
    "Can’t reach the server. Your words are kept on this device and save when the connection returns; trying every few seconds.",
  conflict: "This changed on another device too: choose a version in the banner.",
  locked: "Signed out. Unlock to keep saving; your text is kept on this device.",
};

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14:32 (2 min ago)", "yesterday at 18:02", "3 Oct at 09:15"; "not yet" for null. In local time. */
export function when(at: number | null, now: number): string {
  if (at === null) return "not yet";
  const d = new Date(at);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (days === 0) {
    const min = Math.floor((now - at) / 60_000);
    return `${clock(d)} (${min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ago`})`;
  }
  if (days === 1) return `yesterday at ${clock(d)}`;
  const year = d.getFullYear() === today.getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year} at ${clock(d)}`;
}

/** The two times, in the order that matters for `status`: offline, when the server last answered comes first. */
export function times(status: SaveStatus, savedAt: number | null, reachedAt: number | null, now: number) {
  const saved = { label: "Last saved from this device", value: when(savedAt, now) };
  const reached = { label: "Last reached the server", value: when(reachedAt, now) };
  return status === "offline" ? [reached, saved] : [saved, reached];
}
