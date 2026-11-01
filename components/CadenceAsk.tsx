"use client";

import type { Editor } from "@tiptap/react";
import { useState } from "react";
import { type Rewrite, rewritesIn } from "@/lib/cadenceAsk";
import { useCadence } from "@/lib/cadenceClient";
import { type Analysis, analyze, type Dict } from "@/lib/prosody";
import { focusText } from "@/lib/useCodexPanel";
import { type QuickAsk, useQuickAnswer } from "@/lib/useQuickAnswer";
import { Markdown } from "./ConstructMarkdown";
import { IconClose, IconConstruct } from "./icons";

// Construct's answer to a question asked from Cadence (lib/cadenceAsk.ts), in
// the panel: an explanation of the paragraph, or rewrites of a sentence, each
// scanned by Cadence beside the original so the writer judges the rhythm
// rather than taking the model's word for it. "Use" puts a rewrite in place
// of the sentence (one undo step).

export type CadenceQuestion = {
  /** A new one each time. */
  id: number;
  kind: "explain" | "rewrite";
  ask: QuickAsk;
  /** The sentence to rewrite, and where it is in the manuscript. */
  sentence?: { text: string; from: number; to: number };
};

const ENDING = { firm: "lands on a stress", falling: "falls away", double: "hard stop", unknown: "ending not known" };

/** A line of words (with their punctuation, often what a rewrite changes) over their marks, to compare at a glance. */
function ScanLine({ a, text }: { a: Analysis; text: string }) {
  return (
    <span className="cad-line">
      {a.words.map((w, i) => {
        const lead = i === 0 ? text.slice(0, w.start).trim() : "";
        const gap = text.slice(w.end, a.words[i + 1]?.start ?? text.length).replace(/\s+/g, " ").trim();
        return (
          <span key={i} className="cad-line-word">
            <span>
              {lead}
              {w.text}
              {gap}
            </span>
            <span className="cad-line-marks">{w.stress}</span>
          </span>
        );
      })}
    </span>
  );
}

/** What Cadence hears in a sentence: its runs and its ending. */
function summary(a: Analysis) {
  const runs = a.runs.map((r) => `${r.kind}, ${r.feet} feet${r.steady ? " (steady)" : ""}`);
  return `${a.syllables.length} syllables · ${runs.length ? runs.join(", ") : "no runs"} · ${ENDING[a.sentences.at(-1)?.ending ?? "unknown"]}`;
}

function RewriteRow({ r, dict, onUse }: { r: Rewrite; dict: Dict; onUse: () => void }) {
  const a = analyze(r.text, dict);
  return (
    <li className="cadence-rewrite">
      <ScanLine a={a} text={r.text} />
      <span className="cadence-why">{summary(a)}</span>
      {r.note && <span className="cadence-why">Construct: {r.note}</span>}
      <button type="button" className="btn btn-quiet" onClick={onUse}>
        Use this
      </button>
    </li>
  );
}

type Props = {
  projectId: string;
  question: CadenceQuestion;
  editor: Editor | null;
  onClose: () => void;
  /** Ask the chat instead, where Construct can scan with its tools. */
  onContinue: (prompt: string) => void;
};

export default function CadenceAsk({ projectId, question, editor, onClose, onContinue }: Props) {
  const { answer, status, error } = useQuickAnswer(projectId, question.ask);
  const { dict } = useCadence();
  const [problem, setProblem] = useState<string | null>(null);
  const { sentence } = question;
  const rewrites = question.kind === "rewrite" && status === "done" ? rewritesIn(answer) : [];

  const use = (r: Rewrite) => {
    if (!editor || !sentence) return;
    const { state } = editor;
    if (state.doc.textBetween(sentence.from, sentence.to, " ", " ") !== sentence.text) {
      setProblem("The sentence has changed since; ask again.");
      return;
    }
    editor.view.dispatch(state.tr.insertText(r.text, sentence.from, sentence.to));
    focusText(editor);
    onClose();
  };

  return (
    <section className="cadence-ask" aria-label="Construct’s answer" aria-busy={status === "asking" || status === "slow"}>
      <div className="cadence-word-head">
        <IconConstruct aria-hidden />
        <span className="label">{question.kind === "explain" ? "How it sounds" : "Rewrites for rhythm"}</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" title="Close">
          <IconClose />
        </button>
      </div>

      {sentence && dict && (
        <div className="cadence-rewrite is-original">
          <span className="label">Yours</span>
          <ScanLine a={analyze(sentence.text, dict)} text={sentence.text} />
          <span className="cadence-why">{summary(analyze(sentence.text, dict))}</span>
        </div>
      )}

      {question.kind === "rewrite" && rewrites.length > 0 && dict ? (
        <ol className="cadence-list">
          {rewrites.map((r) => (
            <RewriteRow key={r.text} r={r} dict={dict} onUse={() => use(r)} />
          ))}
        </ol>
      ) : (
        answer && <Markdown text={answer} />
      )}
      {question.kind === "rewrite" && status === "done" && !rewrites.length && (
        <p className="cadence-why">No rewrites came back in a form Cadence could read.</p>
      )}
      {!answer && status === "asking" && <p className="cadence-why">Asking Construct…</p>}
      {!answer && status === "slow" && <p className="cadence-why">Waiting for the model… a self-hosted one may still be loading.</p>}
      {(error || problem) && (
        <p className="cadence-warn" role="alert">
          {error ?? problem}
        </p>
      )}
      <div className="cadence-word-actions">
        <button type="button" className="btn btn-quiet" onClick={() => onContinue(question.ask.prompt)}>
          Continue in Construct
        </button>
      </div>
    </section>
  );
}
