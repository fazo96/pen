import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { buildCmudict, CMUDICT_FILE, compactCmu } from "./cmudictBuild";
import { CACHE_DIR } from "./paths";
import { type Dict, parseCompact } from "./prosody";
import { getProsody } from "./prosodyStore";

// Cadence's pronouncing dictionary (the CMU Pronouncing Dictionary, BSD
// 2-clause), kept gzipped in the cache folder: made by lib/cmudictBuild.ts the
// first time it's asked for (a download of 3.6 MB) unless `npm run dictionary`
// made it already. PEN_PRONUNCIATIONS names a cmudict.dict-style file to use
// instead (the tests' small one, or a server's own copy). Held in memory
// gzipped (about 1 MB), as the page fetches it.

const DIR = path.join(CACHE_DIR, "cmudict");
const FILE = path.join(DIR, CMUDICT_FILE);
// After a failed download, requests wait this long before trying again.
const RETRY_MS = 60_000;

export type Pronunciations = { gz: Buffer; etag: string };

let loading: Promise<Pronunciations> | null = null;
let failedAt = 0;
let failure = "";

const readCache = () =>
  readFile(FILE).catch((err: NodeJS.ErrnoException) => {
    // Missing, or unreadable: made again.
    if (err.code !== "ENOENT") console.error("pronunciations:", err);
    return null;
  });

async function make(): Promise<Buffer> {
  const own = process.env.PEN_PRONUNCIATIONS;
  if (own) return promisify(gzip)(compactCmu(await readFile(own, "utf8")));
  const cached = await readCache();
  if (cached) return cached;
  if (Date.now() - failedAt < RETRY_MS) throw new Error(failure);
  console.log("pronunciations: downloading the CMU Pronouncing Dictionary…");
  try {
    console.log(`pronunciations: ${await buildCmudict(DIR)}`);
  } catch (err) {
    failedAt = Date.now();
    failure = `The pronouncing dictionary couldn’t be downloaded (${(err as Error).message}).`;
    console.error("pronunciations:", err);
    throw new Error(failure);
  }
  const built = await readCache();
  if (!built) throw new Error("The pronouncing dictionary couldn’t be read.");
  return built;
}

/** The dictionary in its compact form, gzipped, made first if it isn't in the cache yet. Throws if it can't be had. */
export function getPronunciations(): Promise<Pronunciations> {
  loading ??= make().then((gz) => ({ gz, etag: `"${createHash("sha1").update(gz).digest("hex").slice(0, 16)}"` }));
  loading.catch(() => (loading = null)); // try again next time
  return loading;
}

let table: Promise<Map<string, string[]>> | null = null;

/**
 * The dictionary for reading prose on the server (Construct's scan_prose),
 * with the writer's words as they are now. Parsed on first use and kept
 * (about 18 MB, 0.1 s).
 */
export async function serverDict(): Promise<Dict> {
  table ??= getPronunciations().then(async ({ gz }) => parseCompact((await promisify(gunzip)(gz)).toString("utf8")));
  table.catch(() => (table = null));
  const [t, own] = await Promise.all([table, getProsody()]);
  return { lookup: (k) => t.get(k), own: own.words };
}
