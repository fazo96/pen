import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyPatch, emptyConfig, sanitizeConfig, type GrammarConfig, type GrammarPatch } from "./grammarConfig";
import { DOCS_DIR } from "./paths";

// The grammar checker's dictionary and switches, one file for the library.
const GRAMMAR_FILE = path.join(DOCS_DIR, ".pen-grammar.json");

export async function getGrammar(): Promise<GrammarConfig> {
  try {
    return sanitizeConfig(JSON.parse(await readFile(GRAMMAR_FILE, "utf8")));
  } catch {
    return emptyConfig(); // missing or unreadable: nothing added yet
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** Apply one change to the saved config. Returns it as saved. */
export function patchGrammar(patch: GrammarPatch): Promise<GrammarConfig> {
  const run = queue.then(async () => {
    const next = applyPatch(await getGrammar(), patch);
    await mkdir(DOCS_DIR, { recursive: true });
    const tmp = `${GRAMMAR_FILE}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await rename(tmp, GRAMMAR_FILE);
    return next;
  });
  queue = run.catch(() => {});
  return run;
}
