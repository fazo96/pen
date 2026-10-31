// How far Construct may change a book's manuscript, as the writer set it in
// the panel: not at all (the default), only its comments, or anything. Kept
// per book (../construct/settings.ts) and checked by every tool that writes
// the manuscript when it runs. Imports nothing: the browser, the prompts and
// plain-Node tests use it.

export const EDIT_MODES = ["off", "comments", "full"] as const;

export type EditMode = (typeof EDIT_MODES)[number];

export const DEFAULT_EDIT_MODE: EditMode = "off";

export const EDIT_MODE_NAMES: Record<EditMode, string> = { off: "Off", comments: "Only comments", full: "Full" };

export function isEditMode(x: unknown): x is EditMode {
  return typeof x === "string" && (EDIT_MODES as readonly string[]).includes(x);
}
