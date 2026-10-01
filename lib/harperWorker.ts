import { Worker } from "node:worker_threads";
import type { GrammarConfig } from "./grammarConfig";
import type { Flag } from "./grammarText";

// Harper for the server, in a worker thread. Loaded, it takes about 450 MB,
// which Node never gives back while the process lives; a worker's goes when
// the worker ends. So lib/grammarServer.ts starts one when it has text to
// check (for the editor or Construct), and it ends after a few idle minutes.
//
// Kept free of pen imports (types aside) so tests can load it with plain Node.

// PEN_GRAMMAR_IDLE_MS overrides it (handy in tests).
const IDLE_MS = Number(process.env.PEN_GRAMMAR_IDLE_MS) || 5 * 60_000;

// Plain JavaScript, run with `eval` (resolving "harper.js" from the app's
// node_modules, which next.config.ts makes sure a standalone build has).
export const WORKER_SOURCE = `
const { parentPort } = require("node:worker_threads");
const DIALECT = { american: 0, british: 1, australian: 2, canadian: 3, indian: 4 };
const SUGGESTION = ["replace", "remove", "insert"];
let linter = null;
let defaults = null;

async function load() {
  if (linter) return linter;
  const { LocalLinter } = await import("harper.js");
  const { binaryInlined } = await import("harper.js/binaryInlined");
  linter = new LocalLinter({ binary: binaryInlined });
  await linter.setup();
  defaults = await linter.getDefaultLintConfig();
  return linter;
}

async function configure(l, dialect, rules, words) {
  if ((await l.getDialect()) !== DIALECT[dialect]) await l.setDialect(DIALECT[dialect]);
  await l.setLintConfig({ ...defaults, ...rules });
  await l.clearWords();
  if (words.length) await l.importWords(words);
}

async function lintFlags(l, text) {
  const flags = [];
  const groups = await l.organizedLints(text, { language: "plaintext" });
  for (const [rule, lints] of Object.entries(groups)) {
    for (const x of lints) {
      const span = x.span();
      flags.push({
        start: span.start,
        end: span.end,
        rule,
        kind: x.lint_kind(),
        message: x.message(),
        problem: x.get_problem_text(),
        suggestions: x.suggestions().map((s) => ({ kind: SUGGESTION[s.kind()], text: s.get_replacement_text() })),
        hash: (await l.contextHash(text, x)).toString(),
      });
    }
  }
  return flags.sort((a, b) => a.start - b.start);
}

parentPort.on("message", async ({ id, config, texts }) => {
  try {
    const l = await load();
    await configure(l, config.dialect, config.rules, config.words);
    const flags = [];
    for (const t of texts) flags.push(await lintFlags(l, t));
    parentPort.postMessage({ id, flags });
  } catch (err) {
    parentPort.postMessage({ id, error: String(err && err.stack || err) });
  }
});
`;

type Settings = { dialect: GrammarConfig["dialect"]; rules: Record<string, boolean>; words: string[] };
type Reply = { id: number; flags?: Flag[][]; error?: string };

let worker: Worker | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;
const pending = new Map<number, (r: Reply) => void>();

function start(): Worker {
  const w = new Worker(WORKER_SOURCE, { eval: true });
  w.on("message", (r: Reply) => {
    pending.get(r.id)?.(r);
    pending.delete(r.id);
  });
  const fail = (err: unknown) => {
    for (const done of pending.values()) done({ id: -1, error: String(err) });
    pending.clear();
    if (worker === w) worker = null;
  };
  w.on("error", fail);
  w.on("exit", (code) => fail(`Harper's worker stopped (${code})`));
  // Don't keep the server alive just for this.
  w.unref();
  return w;
}

/** Harper's flags for each text, with these settings. Starts the worker if it isn't running. */
export function lintInWorker(texts: string[], config: Settings): Promise<Flag[][]> {
  clearTimeout(idle);
  worker ??= start();
  const id = nextId++;
  const w = worker;
  return new Promise<Flag[][]>((resolve, reject) => {
    pending.set(id, (r) => (r.flags ? resolve(r.flags) : reject(new Error(r.error ?? "Harper failed"))));
    w.postMessage({ id, config, texts });
  }).finally(() => {
    if (!pending.size) {
      idle = setTimeout(() => {
        if (worker === w) worker = null;
        void w.terminate();
      }, IDLE_MS);
      idle.unref?.();
    }
  });
}

/** End the worker now (tests). */
export async function stopWorker() {
  clearTimeout(idle);
  const w = worker;
  worker = null;
  await w?.terminate();
}
