import "server-only";
import { readFile, stat } from "node:fs/promises";
import { writeAtomic } from "../files";
import { isValidId } from "../ids";
import { noSpots, sanitizeSpots, type Spot, type Spots, withLast, withSpot } from "../spot";
import { entryFile, isMissing, projectExists, serialize, spotFile } from "./core";

// Where the writer last was in the manuscript and in each Codex entry, and the
// entry viewed last (lib/spot.ts): <project>/spot.json.

export async function readSpots(id: string): Promise<Spots> {
  if (!isValidId(id)) return noSpots();
  try {
    return sanitizeSpots(JSON.parse(await readFile(spotFile(id), "utf8")));
  } catch {
    return noSpots(); // none yet, or unreadable: open at the top
  }
}

/** Unserialized: callers hold the queue. Written only when it changes. */
export async function updateSpots(id: string, change: (s: Spots) => Spots) {
  const before = await readSpots(id);
  const after = change(before);
  if (JSON.stringify(after) !== JSON.stringify(before)) await writeAtomic(spotFile(id), JSON.stringify(after));
}

async function entryExists(id: string, eid: string) {
  try {
    await stat(entryFile(id, eid));
    return true;
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
}

/**
 * Record the manuscript's spot (entry null), or an entry's, which also makes it
 * the last viewed; without a spot, only that. False if the project or entry
 * doesn't exist (unlike writeDoc, this never creates one).
 */
export function writeSpot(id: string, entry: string | null, spot: Spot | null): Promise<boolean> {
  if (!isValidId(id) || (entry !== null && !isValidId(entry))) return Promise.resolve(false);
  return serialize(async () => {
    if (!(await projectExists(id))) return false;
    if (entry !== null && !(await entryExists(id, entry))) return false;
    await updateSpots(id, (s) => (spot ? withSpot(s, entry, spot) : entry ? withLast(s, entry) : s));
    return true;
  });
}
