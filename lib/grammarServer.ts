import "server-only";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { FlagCache } from "./grammarCache";
import { effectiveRules, type GrammarConfig } from "./grammarConfig";
import type { Flag } from "./grammarText";
import { lintInWorker } from "./harperWorker";
import { CACHE_DIR } from "./paths";

// Grammar checking, for the editor (POST /api/grammar/check) and Construct's
// grammar_check alike: Harper's flags per paragraph, unfiltered (the caller
// hides what the settings hide), from the cache on disk or else from Harper,
// run in a worker that ends when idle (./harperWorker.ts).

const cache = new FlagCache(path.join(CACHE_DIR, "grammar"));
// Texts per message to the worker: between them, other requests get a turn,
// so the editor isn't kept waiting while Construct checks a whole book.
const BATCH = 50;
let queue: Promise<unknown> = Promise.resolve();

let harperVersion: string | undefined;
function harper(): string {
  try {
    // Where the worker loads it from.
    const file = path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules", "harper.js", "package.json");
    harperVersion ??= (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
  } catch {
    harperVersion = "unknown";
  }
  return harperVersion;
}

/** Harper's flags for each text, with these settings. */
export async function flagsFor(texts: string[], config: GrammarConfig): Promise<Flag[][]> {
  const settings = { dialect: config.dialect, rules: effectiveRules(config), words: config.words };
  // Harper's own version in it too: a newer one may flag differently.
  const signature = createHash("sha1")
    .update(JSON.stringify({ harper: harper(), ...settings }))
    .digest("hex")
    .slice(0, 16);
  const found = new Map<string, Flag[]>();
  const missing = new Set<string>();
  const look = () => {
    for (const t of texts) {
      if (found.has(t)) continue;
      const flags = cache.get(t);
      if (flags) {
        found.set(t, flags);
        missing.delete(t);
      } else missing.add(t);
    }
  };
  const turn = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      await cache.use(signature);
      return fn();
    });
    queue = run.catch(() => {});
    return run;
  };
  await turn(async () => look());
  while (missing.size) {
    await turn(async () => {
      // Another request may have checked some meanwhile.
      look();
      const batch = [...missing].slice(0, BATCH);
      if (!batch.length) return;
      const flags = await lintInWorker(batch, settings);
      batch.forEach((t, i) => {
        cache.set(t, flags[i]);
        found.set(t, flags[i]);
        missing.delete(t);
      });
    });
  }
  return texts.map((t) => found.get(t) ?? []);
}
