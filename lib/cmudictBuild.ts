import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

// Builds Cadence's pronouncing dictionary from the CMU Pronouncing Dictionary
// (BSD 2-clause, https://github.com/cmusphinx/cmudict): downloads the pinned
// commit's cmudict.dict, checks it, and writes it compacted and gzipped for
// lib/pronunciations.ts. The server does this the first time Cadence asks;
// `npm run dictionary` (scripts/build-dictionary.ts) does it ahead. Kept free
// of pen imports so the script can load it with plain Node.
//
// The compact form: a line per word, "word\tPHONES|PHONES" (its
// pronunciations in the dictionary's order), parsed by parseCompact in
// lib/prosody.

const COMMIT = "74790861f652b15e4ac49015a90074ad62a27690";
const DOWNLOAD = `https://raw.githubusercontent.com/cmusphinx/cmudict/${COMMIT}/cmudict.dict`;
const SHA256 = "81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22";
export const CMUDICT_FILE = `cmudict-${COMMIT.slice(0, 7)}.txt.gz`;
export const CMUDICT_SOURCE = "CMU Pronouncing Dictionary";

/** cmudict.dict's lines ("word(2) PH ONES # comment") gathered by word. */
export function compactCmu(raw: string): string {
  const words = new Map<string, string[]>();
  for (const line of raw.split("\n")) {
    const m = /^(\S+?)(?:\(\d+\))? +([^#]+?)\s*(?:#.*)?$/.exec(line.trim());
    if (!m) continue;
    const key = m[1].toLowerCase();
    words.set(key, [...(words.get(key) ?? []), m[2].replace(/\s+/g, " ")]);
  }
  return [...words].map(([w, p]) => `${w}\t${p.join("|")}`).join("\n");
}

/** `text` compacted and gzipped into `dir`, written aside and moved in so a reader never sees half of it. */
export async function writeCompact(dir: string, compact: string): Promise<number> {
  const gz = await promisify(gzip)(compact);
  const file = path.join(dir, CMUDICT_FILE);
  await mkdir(dir, { recursive: true });
  await writeFile(`${file}.tmp`, gz);
  await rename(`${file}.tmp`, file);
  return gz.length;
}

/** Download the dictionary and write it into `dir`. Resolves with a line for the log. */
export async function buildCmudict(dir: string): Promise<string> {
  const res = await fetch(DOWNLOAD);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());
  const sum = createHash("sha256").update(raw).digest("hex");
  if (sum !== SHA256) throw new Error(`checksum mismatch: got ${sum}`);
  const compact = compactCmu(raw.toString("utf8"));
  const size = await writeCompact(dir, compact);
  return `${compact.split("\n").length} words → ${path.join(dir, CMUDICT_FILE)} (${(size / 1e6).toFixed(1)} MB)`;
}
