// The media queries pen's layout turns on, named once. Keep the widths in step
// with the breakpoints in app/styles/. `useMedia` (lib/useMedia.ts) follows one
// as state; `matches` asks once, for event handlers.

/** Room for a Codex entry beside the manuscript. */
export const WIDE = "(min-width: 1180px)";
/** Room for the Codex entry and Construct at once. */
export const ROOMY = "(min-width: 1800px)";
/** A touch screen: putting the cursor in text there brings up the keyboard. */
export const TOUCH = "(hover: none)";
/** A mouse or trackpad: hover bars rather than toolbar buttons. */
export const MOUSE = "(hover: hover) and (pointer: fine)";

/** Whether `query` matches now (false while rendering on the server). */
export const matches = (query: string) => typeof window !== "undefined" && window.matchMedia(query).matches;
