import { Dialect as HarperDialect, SuggestionKind, type Linter } from "harper.js";
import type { GrammarConfig } from "./grammarConfig";
import type { Flag, Suggestion } from "./grammarText";

// Harper in the browser's worker: configured from pen's settings, answering
// with plain flags. The server's worker (lib/construct/harperWorker.ts) does
// the same in plain JavaScript; tests check the two agree.

const DIALECT: Record<GrammarConfig["dialect"], HarperDialect> = {
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

const defaults = new WeakMap<Linter, Record<string, boolean | null>>();

/** Set the dialect, rules and dictionary words. */
export async function configure(
  linter: Linter,
  dialect: GrammarConfig["dialect"],
  rules: Record<string, boolean>,
  words: string[],
) {
  let base = defaults.get(linter);
  if (!base) defaults.set(linter, (base = await linter.getDefaultLintConfig()));
  if ((await linter.getDialect()) !== DIALECT[dialect]) await linter.setDialect(DIALECT[dialect]);
  await linter.setLintConfig({ ...base, ...rules });
  await linter.clearWords();
  if (words.length) await linter.importWords(words);
}

/** Harper's flags for one block of plain text, in order. */
export async function lintFlags(linter: Linter, text: string): Promise<Flag[]> {
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
