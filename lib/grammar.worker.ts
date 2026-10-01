/// <reference lib="webworker" />
import { Dialect as HarperDialect, LocalLinter, SuggestionKind } from "harper.js";
import { binary } from "harper.js/binary";
import type { Dialect } from "./grammarConfig";
import type { Flag, Suggestion } from "./grammarText";

// Harper, off the main thread. Answers the page with plain data, so the WASM
// (and its 16 MB) is only ever loaded here.

export type WorkerRequest =
  | { id: number; type: "configure"; dialect: Dialect; rules: Record<string, boolean>; words: string[] }
  | { id: number; type: "lint"; texts: string[] };

export type WorkerResponse = { id: number; flags?: Flag[][]; error?: string };

const DIALECT: Record<Dialect, HarperDialect> = {
  american: HarperDialect.American,
  british: HarperDialect.British,
  australian: HarperDialect.Australian,
  canadian: HarperDialect.Canadian,
  indian: HarperDialect.Indian,
};

const SUGGESTION: Record<SuggestionKind, Suggestion["kind"]> = {
  [SuggestionKind.Replace]: "replace",
  [SuggestionKind.Remove]: "remove",
  [SuggestionKind.InsertAfter]: "insert",
};

const linter = new LocalLinter({ binary });
let defaults: Record<string, boolean | null> | null = null;

async function configure(dialect: Dialect, rules: Record<string, boolean>, words: string[]) {
  defaults ??= await linter.getDefaultLintConfig();
  if ((await linter.getDialect()) !== DIALECT[dialect]) await linter.setDialect(DIALECT[dialect]);
  await linter.setLintConfig({ ...defaults, ...rules });
  await linter.clearWords();
  if (words.length) await linter.importWords(words);
}

async function lint(text: string): Promise<Flag[]> {
  const flags: Flag[] = [];
  const groups = await linter.organizedLints(text, { language: "plaintext" });
  for (const [rule, lints] of Object.entries(groups)) {
    for (const l of lints) {
      const span = l.span();
      flags.push({
        start: span.start,
        end: span.end,
        rule,
        kind: l.lint_kind(),
        message: l.message(),
        problem: l.get_problem_text(),
        suggestions: l.suggestions().map((s) => ({ kind: SUGGESTION[s.kind()], text: s.get_replacement_text() })),
        hash: (await linter.contextHash(text, l)).toString(),
      });
    }
  }
  return flags.sort((a, b) => a.start - b.start);
}

// One request at a time, in order.
let queue: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  queue = queue.then(async () => {
    let res: WorkerResponse;
    try {
      if (req.type === "configure") {
        await configure(req.dialect, req.rules, req.words);
        res = { id: req.id };
      } else {
        const flags: Flag[][] = [];
        for (const t of req.texts) flags.push(await lint(t));
        res = { id: req.id, flags };
      }
    } catch (err) {
      res = { id: req.id, error: String(err) };
    }
    self.postMessage(res);
  });
};
