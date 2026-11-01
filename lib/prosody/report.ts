import type { Analysis } from "./index";
import { soundName } from "./phones";

// Cadence's reading of a passage as text, for a language model: Construct's
// scan_prose, and the questions the panel asks. Each word followed by its
// marks, then the runs, the echoes, how each sentence ends, and the words
// whose stress is only a guess. Pure.

export const SCAN_LEGEND =
  "Marks, one per syllable: / stressed, x light, \\ half (a secondary stress), ? not known. Stress comes from a pronouncing dictionary (American) plus rules: one-syllable function words (the, of, was…) are light, other one-syllable words stressed. A run is a stretch where each stress is one or two light syllables from the next; held long in one foot (steady) it starts to sound like verse.";

const ENDINGS = { firm: "ends on a stress", falling: "falls away on a light syllable", double: "ends on two stresses", unknown: "ending not known" };

/** The words a span of syllables covers, shortened past eight. */
function quote(a: Analysis, fromWord: number, toWord: number) {
  const ws = a.words.slice(fromWord, toWord + 1).map((w) => w.text);
  return `“${ws.length > 8 ? `${ws.slice(0, 4).join(" ")} … ${ws.slice(-3).join(" ")}` : ws.join(" ")}”`;
}

/** One passage's reading: `label` names it ("pen:L12", "The sentence"). */
export function passageReport(label: string, text: string, a: Analysis): string {
  if (!a.words.length) return `${label}: no words.`;
  const marked = a.words
    .map((w, i) => {
      const next = a.words[i + 1];
      const gap = text.slice(w.end, next?.start ?? text.length).replace(/\s+/g, " ").trim();
      const lead = i === 0 ? text.slice(0, w.start).trim() : "";
      return `${lead}${w.text}(${w.stress})${gap}`;
    })
    .join(" ");
  const lines = [`${label} · ${a.sentences.length} ${a.sentences.length === 1 ? "sentence" : "sentences"}, ${a.syllables.length} syllables`, marked];
  if (a.runs.length) {
    lines.push(
      `Runs: ${a.runs
        .map((r) => `${r.kind}, ${r.feet} feet${r.steady ? " (steady)" : ""}: ${quote(a, a.syllables[r.from].word, a.syllables[r.to].word)}`)
        .join("; ")}`,
    );
  } else lines.push("Runs: none.");
  if (a.sounds.length) {
    lines.push(
      `Echoes: ${a.sounds
        .map((g) => `${g.kind} on “${soundName(g.sound)}”: ${g.words.map((w) => a.words[w].text).join(" · ")}${g.atEnds ? " (both end a clause)" : ""}`)
        .join("; ")}`,
    );
  }
  lines.push(
    `Sentences: ${a.sentences.map((s, i) => `${a.sentences.length > 1 ? `${i + 1}) ` : ""}${s.syllables} syllables, ${ENDINGS[s.ending]}`).join("; ")}`,
  );
  for (const o of a.openings) lines.push(`${o.sentences.length} sentences open on “${o.text}”.`);
  const guessed = [...new Set(a.words.filter((w) => w.source === "guess" && w.stress !== "?").map((w) => `${w.text}(${w.stress})`))];
  if (guessed.length) lines.push(`Not in the dictionary, stress guessed: ${guessed.join(", ")}.`);
  const yours = [...new Set(a.words.filter((w) => w.source === "yours").map((w) => w.text))];
  if (yours.length) lines.push(`Said the writer's way: ${yours.join(", ")}.`);
  return lines.join("\n");
}
