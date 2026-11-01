"use client";

import { useState } from "react";
import { cadence } from "@/lib/cadenceClient";
import type { Word } from "@/lib/prosody";
import type { OwnWord } from "@/lib/prosody/own";
import { ipa } from "@/lib/prosody/phones";
import { IconClose } from "./icons";

// One word of Cadence's passage, picked: how it's said and where that comes
// from, the other stresses the dictionary gives (to try), and the writer's
// own way of saying it, kept for every book (lib/cadenceClient.ts).

const SOURCE_TEXT: Record<Word["source"], string> = {
  dictionary: "From the pronouncing dictionary.",
  yours: "Said your way.",
  compound: "Not in the dictionary: read as two words it knows.",
  ending: "Not in the dictionary: read as a word it knows plus an ending.",
  guess: "Not in the dictionary: syllables counted from the spelling, the first taken as stressed.",
};

const CYCLE: Record<string, string> = { "/": "x", x: "\\", "\\": "/" };
const MAX_SYLLABLES = 12;
const LIKE_RE = /^[\p{L}\p{M}' -]{0,64}$/u;

type Props = {
  word: Word;
  /** The writer's pronunciation of it, if they set one. */
  own?: OwnWord;
  /** Read the passage with this stress on the word (a what-if). */
  onTry: (stress: string) => void;
  /** Select it in the manuscript. */
  onShow: () => void;
  onClose: () => void;
};

export default function CadenceWord({ word, own, onTry, onShow, onClose }: Props) {
  const [editing, setEditing] = useState(word.source === "guess" && !own);
  const [stress, setStress] = useState((own?.stress ?? word.stress).replace(/\?/g, "/"));
  const [like, setLike] = useState(own?.like ?? "");
  const [error, setError] = useState<string | null>(null);
  const likeOk = LIKE_RE.test(like.trim());

  const save = async () => {
    setError(null);
    try {
      await cadence.setWord(word.key, { stress, ...(like.trim() ? { like: like.trim() } : {}) });
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const remove = async () => {
    setError(null);
    try {
      await cadence.removeWord(word.key);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section className="cadence-word" aria-label={`“${word.text}”`}>
      <div className="cadence-word-head">
        <strong className="cadence-word-text">{word.text}</strong>
        {word.phones && <span className="cadence-ipa">/{ipa(word.phones)}/</span>}
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" title="Close">
          <IconClose />
        </button>
      </div>
      <p className="cadence-why">
        {SOURCE_TEXT[word.source]}
        {word.light && " A short function word: light in running speech."}
      </p>
      <div className="cadence-word-actions">
        {word.alternatives.map((alt) => (
          <button key={alt} type="button" className="btn btn-quiet" onClick={() => onTry(alt)} title="Read the passage with this stress">
            Try {[...alt].join(" ")}
          </button>
        ))}
        <button type="button" className="btn btn-quiet" onClick={onShow}>
          Show in text
        </button>
        {!editing && (
          <button type="button" className="btn btn-quiet" onClick={() => setEditing(true)}>
            {own ? "Change how you say it" : "Say it your way"}
          </button>
        )}
      </div>

      {editing && (
        <form
          className="cadence-own"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <span className="label">Stress, a mark per syllable</span>
          <div className="cadence-own-marks">
            {[...stress].map((m, k) => (
              <button
                key={k}
                type="button"
                className={`cad-mark cad-big ${m === "/" ? "beat-S" : "beat-W"}`}
                onClick={() => setStress(stress.slice(0, k) + CYCLE[m] + stress.slice(k + 1))}
                aria-label={`Syllable ${k + 1}: ${m === "/" ? "stressed" : m === "x" ? "light" : "half"}`}
              >
                {m}
              </button>
            ))}
            <button type="button" className="btn btn-quiet" disabled={stress.length <= 1} onClick={() => setStress(stress.slice(0, -1))} aria-label="One syllable fewer">
              −
            </button>
            <button type="button" className="btn btn-quiet" disabled={stress.length >= MAX_SYLLABLES} onClick={() => setStress(`${stress}x`)} aria-label="One syllable more">
              +
            </button>
          </div>
          <label className="field">
            <span className="label">Sounds like (English words, optional)</span>
            <input value={like} onChange={(e) => setLike(e.target.value)} placeholder="e.g. quoth, or den uh" autoComplete="off" spellCheck={false} />
          </label>
          <p className="cadence-why">With a sounds-like, the word joins the echoes: “Kvothe” like “quoth”.</p>
          {error && <p className="cadence-warn">{error}</p>}
          <div className="cadence-word-actions">
            <button type="submit" className="btn btn-primary" disabled={!likeOk}>
              Save, for every book
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {own && !editing && (
        <p className="cadence-why">
          Yours: {[...(own.stress ?? "")].join(" ")}
          {own.like && ` · sounds like “${own.like}”`}{" "}
          <button type="button" className="cadence-reset" onClick={() => void remove()}>
            Forget it
          </button>
        </p>
      )}
    </section>
  );
}
