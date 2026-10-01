// Builds the dictionary ahead of the first look-up (the server otherwise does
// it then), e.g. for a server that can't reach GitHub: `npm run dictionary`.
// Writes into PEN_CACHE_DIR (default ./cache), as the server would.

import path from "node:path";
import { buildWordnet } from "../lib/wordnetBuild.ts";

const dir = path.join(path.resolve(process.env.PEN_CACHE_DIR ?? "cache"), "wordnet");
console.log("dictionary: downloading Open English WordNet…");
console.log(`dictionary: ${await buildWordnet(dir)}`);
