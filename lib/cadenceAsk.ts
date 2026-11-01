// What Cadence asks Construct (a one-off answer, no tools: lib/useQuickAnswer.ts),
// with its own reading of the passage in the question (lib/prosody/report.ts),
// so the model reasons from the stresses the writer sees rather than its own
// unreliable ear; and the rewrites read back out of an answer, for Cadence to
// scan each one. Pure.

import { SCAN_LEGEND } from "./prosody/report";

/** Questions longer than this are cut by the quick route; a passage's reading is kept under it. */
export const MAX_QUESTION = 8000;

const READER =
  "The writer is learning to write near-verse prose by ear, without training in poetry, and English may not be their first language: use plain words (da-DUM), naming a term only alongside what it means.";

/** Why the paragraph sounds as it does: `report` is Cadence's reading of it. */
export function explainPrompt(report: string): string {
  return `Cadence, pen's reading of how prose sounds, read this paragraph as follows.

${SCAN_LEGEND}

${report}

${READER} Explain why it sounds the way it does: where the rhythm flows and where it stumbles or stops, what the echoing sounds do, how its sentences land. Point at the words; don't rewrite anything. Short paragraphs, no preamble.`;
}

/** Up to three rewrites of one sentence for its rhythm: `report` is Cadence's reading of the sentence. */
export function rewritePrompt(sentence: string, report: string): string {
  return `Rewrite this sentence for rhythm (the writer asked for rewrites): “${sentence}”

Cadence, pen's reading of how prose sounds, reads it as follows.

${SCAN_LEGEND}

${report}

${READER} Give up to 3 rewrites that keep its meaning, its names, its tense and the book's voice, and change as few words as will do, each with a smoother or more deliberate rhythm. One per line, numbered: the whole sentence with its punctuation, then " — " and a few words on what changed in its sound. Nothing else: Cadence will scan each one for the writer.`;
}

export type Rewrite = { text: string; note: string };

/** The numbered rewrites in an answer: "1. The sentence. — what changed", quotes and emphasis dropped. */
export function rewritesIn(answer: string): Rewrite[] {
  const out: Rewrite[] = [];
  for (const raw of answer.split("\n")) {
    const m = raw.trim().match(/^(?:\d+[.)]|[-*•])\s+(.+)$/);
    if (!m) continue;
    const [body, ...rest] = m[1].split(/\s+[—–]\s+|\s+-\s+(?=\p{Ll})/u);
    const text = body
      .replace(/^\*\*(.+)\*\*$/, "$1")
      .replace(/^[“"](.+)[”"]$/, "$1")
      .trim();
    if (/\p{L}/u.test(text) && !out.some((r) => r.text === text)) out.push({ text, note: rest.join(" — ").trim() });
  }
  return out.slice(0, 3);
}
