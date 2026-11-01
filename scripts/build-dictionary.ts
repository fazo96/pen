// Builds the dictionaries ahead of their first use (the server otherwise does
// it then), e.g. for a server that can't reach GitHub: `npm run dictionary`.
// Writes into PEN_CACHE_DIR (default ./cache), as the server would: Open
// English WordNet for Look up, the CMU Pronouncing Dictionary for Cadence.

import path from "node:path";
import { buildCmudict } from "../lib/cmudictBuild.ts";
import { buildWordnet } from "../lib/wordnetBuild.ts";

const cache = path.resolve(process.env.PEN_CACHE_DIR ?? "cache");
console.log("dictionary: downloading Open English WordNet…");
console.log(`dictionary: ${await buildWordnet(path.join(cache, "wordnet"))}`);
console.log("dictionary: downloading the CMU Pronouncing Dictionary…");
console.log(`dictionary: ${await buildCmudict(path.join(cache, "cmudict"))}`);
