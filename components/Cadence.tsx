"use client";

import type { Editor } from "@tiptap/react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useCadence } from "@/lib/cadenceClient";
import { type Passage, passageAt } from "@/lib/cadenceText";
import { type Analysis, analyze } from "@/lib/prosody";
import type { Ending } from "@/lib/prosody/cadence";
import { soundName } from "@/lib/prosody/phones";
import { MIN_FEET, type RunKind } from "@/lib/prosody/rhythm";
import type { SoundKind } from "@/lib/prosody/sounds";
import { explainPrompt, MAX_QUESTION, rewritePrompt } from "@/lib/cadenceAsk";
import { passageReport } from "@/lib/prosody/report";
import { focusText } from "@/lib/useCodexPanel";
import CadenceAsk, { type CadenceQuestion } from "./CadenceAsk";
import CadenceWord from "./CadenceWord";
import { IconClose } from "./icons";

// Cadence (docs/cadence.md): the sound of the paragraph at the manuscript's
// cursor, read again 200 ms after typing or moving pauses. Each word shows
// its stresses under it (a tap tries another, for this reading only); below
// are the rhythmic runs, the echoing sounds, how each sentence ends, and
// the words the dictionary doesn't know. In the Codex panel's slot on wide
// screens (CadencePanel), and as the drawer's tab (CadenceView).

const SETTLE_MS = 200;

const RUN_TEXT: Record<RunKind, string> = {
  iambic: "da-DUM da-DUM: rising, like a heartbeat",
  trochaic: "DUM-da DUM-da: falling, like a chant",
  anapestic: "da-da-DUM: rising, galloping",
  dactylic: "DUM-da-da: falling, rolling",
  rising: "light syllables leading into each stress, feet of two and three mixed",
  falling: "each stress leading, one or two light syllables falling after it",
};
const RISING = new Set<RunKind>(["iambic", "anapestic", "rising"]);

const SOUND_TEXT: Record<SoundKind, string> = {
  alliteration: "Nearby words that open (or stress) on the same consonant.",
  assonance: "The same vowel in nearby stressed syllables.",
  rhyme: "The same stressed vowel and everything after it.",
};

const ENDING_TEXT: Record<Ending, string> = {
  firm: "lands on a stress",
  falling: "falls away on a light syllable",
  double: "two stresses: a hard stop",
  unknown: "its last word's stress isn't known",
};

/** What's lit in the passage: a run, an echo or a sentence, picked from the lists below it. */
type Lit = { kind: "run" | "sound" | "sentence"; index: number };

/** The passage at the cursor, once moving and typing pause. */
function usePassage(editor: Editor | null): Passage | null {
  const [passage, setPassage] = useState<Passage | null>(null);
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      if (editor.isDestroyed) return;
      const { from, to } = editor.state.selection;
      setPassage(passageAt(editor.state.doc, from, to));
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(read, SETTLE_MS);
    };
    read();
    editor.on("transaction", later);
    return () => {
      clearTimeout(timer);
      editor.off("transaction", later);
    };
  }, [editor]);
  return passage;
}

/** The next stress a tap on a syllable tries. */
const flipped = (m: string) => (m === "/" ? "x" : "/");

/** Asking Construct from Cadence, when AI is on: the book, and the way into the chat. */
export type CadenceAsking = { projectId: string; onContinue: (prompt: string) => void };

export function CadenceView({ editor, onShown, ask }: { editor: Editor | null; onShown?: () => void; ask?: CadenceAsking }) {
  const { status, error, dict, own } = useCadence();
  const passage = usePassage(editor);
  const text = passage?.text ?? "";
  // What-ifs, a lit item and a picked word belong to the text they were made on.
  const [flips, setFlips] = useState<{ text: string; marks: Record<number, string> }>({ text: "", marks: {} });
  const [lit, setLit] = useState<(Lit & { text: string }) | null>(null);
  const [picked, setPicked] = useState<{ text: string; index: number } | null>(null);
  const marks = useMemo(() => (flips.text === text ? flips.marks : {}), [flips, text]);
  const a = useMemo(() => (dict && text ? analyze(text, dict, marks) : null), [dict, text, marks]);
  const shownLit = lit?.text === text ? lit : null;
  const pickedWord = picked?.text === text && a ? a.words[picked.index] : null;
  // Construct's answer stays until closed, whatever the cursor does meanwhile.
  const [question, setQuestion] = useState<CadenceQuestion | null>(null);

  const flip = (i: number, k: number) => {
    if (!a) return;
    const s = a.words[i].stress;
    setFlips({ text, marks: { ...marks, [i]: s.slice(0, k) + flipped(s[k]) + s.slice(k + 1) } });
  };
  const tryStress = (i: number, stress: string) => setFlips({ text, marks: { ...marks, [i]: stress } });
  const toggleLit = (l: Lit) => setLit(shownLit?.kind === l.kind && shownLit.index === l.index ? null : { ...l, text });
  const explain = () => {
    if (!a) return;
    const report = passageReport(passage!.blocks === 1 ? "The paragraph" : "The passage", text, a).slice(0, MAX_QUESTION - 2000);
    setQuestion({ id: Date.now(), kind: "explain", ask: { prompt: explainPrompt(report), context: {} } });
  };
  const rewrite = (i: number) => {
    const s = a?.sentences[i];
    if (!a || !s || !dict || !passage) return;
    const start = a.words[s.from].start;
    // Through its closing punctuation and quotes, up to the space after it.
    const end = a.words[s.to].end + (/^\S*/.exec(text.slice(a.words[s.to].end))?.[0].length ?? 0);
    const sentence = text.slice(start, end);
    const range = passage.range(start, end);
    if (!range) return;
    const paragraph = text.slice(text.lastIndexOf("\n\n", start) + 1, text.indexOf("\n\n", end) < 0 ? undefined : text.indexOf("\n\n", end)).trim();
    const report = passageReport("The sentence", sentence, analyze(sentence, dict));
    setQuestion({
      id: Date.now(),
      kind: "rewrite",
      ask: { prompt: rewritePrompt(sentence, report), context: { selection: sentence, paragraph } },
      sentence: { text: sentence, ...range },
    });
  };
  const showInText = (i: number) => {
    const w = a?.words[i];
    const r = w && passage?.range(w.start, w.end);
    if (!editor || !r) return;
    editor.chain().setTextSelection(r).scrollIntoView().run();
    onShown?.();
    focusText(editor);
  };

  if (status === "failed") {
    return (
      <div className="cadence">
        <p className="cadence-empty">{error}</p>
      </div>
    );
  }
  if (!dict) {
    return (
      <div className="cadence" aria-busy>
        <p className="cadence-empty">Loading the pronouncing dictionary…</p>
      </div>
    );
  }
  if (!passage || !a?.words.length) {
    return (
      <div className="cadence">
        <p className="cadence-empty">Put the cursor in a paragraph of the manuscript, or select a few, to hear how they sound.</p>
      </div>
    );
  }

  // Each guessed word once (numbers aren't words to say).
  const unknown: number[] = [];
  const seen = new Set<string>();
  a.words.forEach((w, i) => {
    if (w.source !== "guess" || w.stress === "?" || seen.has(w.key)) return;
    seen.add(w.key);
    unknown.push(i);
  });
  const flippedAny = Object.keys(marks).length > 0;

  return (
    <div className="cadence">
      <p className="cadence-status label" role="status">
        {passage.blocks === 1 ? "This paragraph" : `${passage.blocks} paragraphs`}
        {passage.cut && " (the first of the selection)"} · {a.syllables.length} syllables
        {ask && (
          <button type="button" className="cadence-reset" onClick={explain}>
            Explain how it sounds
          </button>
        )}
      </p>

      <PassageView a={a} text={text} marks={marks} lit={shownLit} picked={picked?.text === text ? picked.index : null} onFlip={flip} onPick={(index) => setPicked(picked?.text === text && picked.index === index ? null : { text, index })} />

      <p className="cadence-legend">
        <span className="cad-key beat-S">/</span> stressed <span className="cad-key beat-W">x</span> light <span className="cad-key">\</span> half
        {flippedAny ? (
          <button type="button" className="cadence-reset" onClick={() => setFlips({ text, marks: {} })}>
            Undo what-ifs
          </button>
        ) : (
          <span className="cadence-hint"> · tap a mark to try another stress, a word for more</span>
        )}
      </p>

      {question && ask && (
        <CadenceAsk
          key={question.id}
          projectId={ask.projectId}
          question={question}
          editor={editor}
          onClose={() => setQuestion(null)}
          onContinue={(prompt) => {
            setQuestion(null);
            ask.onContinue(prompt);
          }}
        />
      )}

      {pickedWord && (
        <CadenceWord
          key={`${picked!.index}:${pickedWord.key}`}
          word={pickedWord}
          own={own?.words[pickedWord.key]}
          onTry={(stress) => tryStress(picked!.index, stress)}
          onShow={() => showInText(picked!.index)}
          onClose={() => setPicked(null)}
        />
      )}

      <section className="cadence-section">
        <h3 className="cadence-head label">Rhythm</h3>
        {a.runs.length ? (
          <ul className="cadence-list">
            {a.runs.map((r, i) => (
              <li key={`${r.from}`}>
                <button type="button" className={`cadence-item ${shownLit?.kind === "run" && shownLit.index === i ? "is-on" : ""}`} onClick={() => toggleLit({ kind: "run", index: i })}>
                  <span className={`cad-swatch ${r.steady ? "run-steady" : RISING.has(r.kind) ? "run-rise" : "run-fall"}`} aria-hidden />
                  <span>
                    <strong>{r.kind}</strong>, {r.feet} feet: {wordsIn(a, r.from, r.to)}
                    <span className="cadence-why">{RUN_TEXT[r.kind]}.</span>
                    {r.steady && <span className="cadence-warn">Held this long, one foot starts to sound like verse: break it somewhere, unless that’s the point.</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cadence-none">
            No runs of {MIN_FEET} stresses or more: each stress here is more than two light syllables from the next, or right beside it.
          </p>
        )}
      </section>

      <section className="cadence-section">
        <h3 className="cadence-head label">Sounds</h3>
        {a.sounds.length ? (
          <ul className="cadence-list">
            {a.sounds.map((g, i) => (
              <li key={`${g.kind}:${g.sound}:${g.words[0]}`}>
                <button
                  type="button"
                  className={`cadence-item ${shownLit?.kind === "sound" && shownLit.index === i ? "is-on" : ""}`}
                  onClick={() => toggleLit({ kind: "sound", index: i })}
                  title={SOUND_TEXT[g.kind]}
                >
                  <span className={`cad-swatch sound-${g.kind}`} aria-hidden />
                  <span>
                    <strong>{g.kind}</strong> on “{soundName(g.sound)}”: {g.words.map((w) => a.words[w].text).join(" · ")}
                    {g.atEnds && <span className="cadence-warn">Both end a clause, where a rhyme sounds like verse. Fine if you meant it.</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cadence-none">No sounds echo between nearby words.</p>
        )}
      </section>

      <section className="cadence-section">
        <h3 className="cadence-head label">Sentences</h3>
        <ol className="cadence-list">
          {a.sentences.map((s, i) => {
            const most = Math.max(...a.sentences.map((x) => x.syllables));
            return (
              <li key={`${s.from}`}>
                <button type="button" className={`cadence-item cadence-sentence ${shownLit?.kind === "sentence" && shownLit.index === i ? "is-on" : ""}`} onClick={() => toggleLit({ kind: "sentence", index: i })}>
                  <span className="cad-bar" style={{ width: `${(100 * s.syllables) / most}%` }} aria-hidden />
                  <span>
                    {s.syllables} syllables, {ENDING_TEXT[s.ending]}
                    <span className="cadence-why">“{tailOf(a, s.from, s.to)}”</span>
                  </span>
                </button>
                {ask && shownLit?.kind === "sentence" && shownLit.index === i && (
                  <button type="button" className="btn btn-quiet cadence-rewrite-ask" onClick={() => rewrite(i)}>
                    Rewrite for rhythm
                  </button>
                )}
              </li>
            );
          })}
        </ol>
        {a.openings.map((o) => (
          <p key={o.sentences.join()} className="cadence-note">
            {o.sentences.length} sentences open on “{o.text}”: a repetition that builds (anaphora).
          </p>
        ))}
      </section>

      {unknown.length > 0 && (
        <section className="cadence-section">
          <h3 className="cadence-head label">Not in the dictionary</h3>
          <p className="cadence-none">Guessed from the spelling, the first syllable stressed. Say how you say them and Cadence remembers, in every book.</p>
          <ul className="cadence-unknown">
            {unknown.map((i) => (
              <li key={a.words[i].key}>
                <button type="button" onClick={() => setPicked({ text, index: i })}>
                  {a.words[i].text}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The words a run's syllables span. */
function wordsIn(a: Analysis, from: number, to: number): string {
  const ws = a.words.slice(a.syllables[from].word, a.syllables[to].word + 1).map((w) => w.text);
  return `“${ws.length > 8 ? `${ws.slice(0, 4).join(" ")} … ${ws.slice(-3).join(" ")}` : ws.join(" ")}”`;
}

/** A sentence's last few words. */
const tailOf = (a: Analysis, from: number, to: number) => {
  const start = Math.max(from, to - 3);
  return (start > from ? "…" : "") + a.words.slice(start, to + 1).map((w) => w.text).join(" ");
};

type PassageProps = {
  a: Analysis;
  text: string;
  marks: Record<number, string>;
  lit: Lit | null;
  picked: number | null;
  onFlip: (word: number, syllable: number) => void;
  onPick: (word: number) => void;
};

/** The passage, a word at a time with its marks under it. */
function PassageView({ a, text, marks, lit, picked, onFlip, onPick }: PassageProps) {
  // Which run each syllable is in, and which words are lit.
  const runOf = new Map<number, number>();
  a.runs.forEach((r, i) => {
    for (let s = r.from; s <= r.to; s++) runOf.set(s, i);
  });
  const litWords = new Set<number>();
  if (lit?.kind === "run") {
    const r = a.runs[lit.index];
    for (let s = r.from; s <= r.to; s++) litWords.add(a.syllables[s].word);
  } else if (lit?.kind === "sound") for (const w of a.sounds[lit.index].words) litWords.add(w);
  else if (lit?.kind === "sentence") for (let w = a.sentences[lit.index].from; w <= a.sentences[lit.index].to; w++) litWords.add(w);

  let syl = 0;
  return (
    <div className="cad-passage">
      {a.words.map((w, i) => {
        const next = a.words[i + 1];
        const gap = text.slice(w.end, next?.start ?? text.length);
        const lead = i === 0 ? text.slice(0, w.start).trim() : "";
        const first = syl;
        syl += w.stress.length;
        const classes = [
          "cad-word",
          w.source === "guess" && "is-guess",
          w.source === "yours" && "is-yours",
          w.alternatives.length > 0 && "is-ambiguous",
          i in marks && "is-flipped",
          litWords.has(i) && "is-lit",
          picked === i && "is-picked",
        ];
        return (
          <Fragment key={i}>
            <span className={classes.filter(Boolean).join(" ")}>
              <button type="button" className="cad-text" onClick={() => onPick(i)} aria-pressed={picked === i}>
                {lead}
                {w.text}
                {gap.replace(/\s+/g, " ").trim()}
              </button>
              <span className="cad-marks">
                {[...w.stress].map((m, k) => {
                  const s = a.syllables[first + k];
                  const run = runOf.get(first + k);
                  const band = run === undefined ? "" : a.runs[run].steady ? "run-steady" : RISING.has(a.runs[run].kind) ? "run-rise" : "run-fall";
                  return (
                    <button
                      key={k}
                      type="button"
                      className={`cad-mark beat-${s.beat} ${band}`}
                      onClick={() => onFlip(i, k)}
                      aria-label={`${w.text}, syllable ${k + 1}: ${s.beat === "S" ? "stressed" : s.beat === "W" ? "light" : "not known"}. Try the other`}
                    >
                      {m}
                    </button>
                  );
                })}
              </span>
            </span>
            {gap.includes("\n") && <span className="cad-break" aria-hidden />}
          </Fragment>
        );
      })}
    </div>
  );
}

/** Cadence in the Codex panel's slot, beside the manuscript. */
export default function CadencePanel({ editor, onClose, ask }: { editor: Editor | null; onClose: () => void; ask?: CadenceAsking }) {
  return (
    <aside className="codex-panel cadence-panel" aria-label="Cadence">
      <div className="codex-panel-head">
        <span className="codex-panel-title label">Cadence</span>
        <div className="construct-head-actions">
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close Cadence" title="Close">
            <IconClose />
          </button>
        </div>
      </div>
      <div className="cadence-body">
        <CadenceView editor={editor} ask={ask} />
      </div>
    </aside>
  );
}
