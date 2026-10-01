import { spawn } from "node:child_process";

// Builds pen's dictionary from Open English WordNet (CC-BY 4.0,
// https://en-word.net): downloads the pinned release, checks it, and writes a
// compact index for lib/dictionary.ts. The server does this on the first
// look-up; `npm run dictionary` (scripts/build-dictionary.ts) does it ahead.
//
// It runs in a child process: parsing WordNet takes a few hundred MB, which
// the server would keep until it restarts (a worker thread's is only partly
// given back). Kept free of pen imports so the script can load it with plain
// Node.
//
// The index (format version 2):
//   w: lowercased word → comma-separated synset numbers, in WordNet's order
//   s: per synset, a JSON string: [pos, definition, examples, members,
//      similar, broader, narrower, opposites] (the last four as word lists)
//   f: lowercased irregular form → "lemma:pos|…" (geese → "goose:n")
//   p: lowercased word → pronunciation (IPA)

export const WORDNET_FILE = "oewn-2025.json.gz";

// Plain JavaScript, run with `node -e`; the folder to write into is its argument.
const SOURCE = `
const { createHash } = require("node:crypto");
const { mkdir, rename, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { gzip, inflateRawSync } = require("node:zlib");

const DOWNLOAD = "https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025-json.zip";
const SHA256 = "7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51";
const FILE = ${JSON.stringify(WORDNET_FILE)};
const MAX_EXAMPLES = 2;
// More specific words: the first word of each narrower meaning (stroll, amble,
// trudge… for "walk"), which leaves out rare senses of other words ("cock").
const MAX_NARROWER = 80;

// The files in a zip, by name (stored or deflated entries only).
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip directory");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (!name.endsWith("/")) files.set(name, method === 8 ? inflateRawSync(data) : method === 0 ? data : null);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const lemmaOf = (senseKey) => senseKey.slice(0, senseKey.indexOf("%")).replace(/_/g, " ");

async function build(dir) {
  const res = await fetch(DOWNLOAD);
  if (!res.ok) throw new Error("download failed: " + res.status);
  const zip = Buffer.from(await res.arrayBuffer());
  const sum = createHash("sha256").update(zip).digest("hex");
  if (sum !== SHA256) throw new Error("checksum mismatch: got " + sum);

  const synsets = {};
  const entries = {};
  for (const [name, data] of unzip(zip)) {
    if (!data || !name.endsWith(".json") || name.endsWith("frames.json")) continue;
    Object.assign(path.basename(name).startsWith("entries-") ? entries : synsets, JSON.parse(data.toString("utf8")));
  }

  const ids = Object.keys(synsets);
  const index = new Map(ids.map((id, i) => [id, i]));
  const narrower = new Map();
  for (const [id, s] of Object.entries(synsets)) {
    for (const h of s.hypernym ?? []) narrower.set(h, [...(narrower.get(h) ?? []), id]);
  }
  // Opposites are recorded per sense; gather them on the sense's synset.
  const opposites = new Map();
  const words = new Map();
  const forms = new Map();
  const prons = new Map();
  for (const [lemma, byPos] of Object.entries(entries)) {
    const key = lemma.toLowerCase();
    const list = words.get(key) ?? [];
    for (const [pos, e] of Object.entries(byPos)) {
      for (const s of e.sense) {
        const n = index.get(s.synset);
        if (n === undefined) continue;
        if (!list.includes(n)) list.push(n);
        for (const a of s.antonym ?? []) {
          const set = opposites.get(n) ?? new Set();
          set.add(lemmaOf(a));
          opposites.set(n, set);
        }
      }
      for (const f of e.form ?? []) {
        const set = forms.get(f.toLowerCase()) ?? new Set();
        set.add(key + ":" + pos);
        forms.set(f.toLowerCase(), set);
      }
      const pron = e.pronunciation?.[0]?.value;
      if (pron && !prons.has(key)) prons.set(key, pron);
    }
    words.set(key, list);
  }

  const membersOf = (id) => synsets[id]?.members ?? [];
  const s = ids.map((id, n) => {
    const x = synsets[id];
    return JSON.stringify([
      x.partOfSpeech,
      x.definition?.[0] ?? "",
      (x.example ?? []).slice(0, MAX_EXAMPLES).map((e) => (typeof e === "string" ? e : e.text)),
      x.members,
      [...new Set((x.similar ?? []).flatMap(membersOf))],
      [...new Set((x.hypernym ?? []).flatMap(membersOf))],
      [...new Set((narrower.get(id) ?? []).map((h) => membersOf(h)[0]).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b))
        .slice(0, MAX_NARROWER),
      [...(opposites.get(n) ?? [])],
    ]);
  });

  const out = {
    v: 2,
    source: "Open English WordNet 2025",
    w: Object.fromEntries([...words].map(([k, v]) => [k, v.join(",")])),
    s,
    f: Object.fromEntries([...forms].map(([k, v]) => [k, [...v].join("|")])),
    p: Object.fromEntries(prons),
  };
  const gz = await promisify(gzip)(JSON.stringify(out));
  const file = path.join(dir, FILE);
  await mkdir(dir, { recursive: true });
  // Written aside and moved in, so a reader never sees half of it.
  await writeFile(file + ".tmp", gz);
  await rename(file + ".tmp", file);
  return words.size + " words, " + ids.length + " meanings → " + file + " (" + (gz.length / 1e6).toFixed(1) + " MB)";
}

build(process.argv[1]).then(
  (done) => console.log(done),
  (err) => {
    console.error(err.message);
    process.exit(1);
  },
);
`;

/** Download WordNet and write the index into `dir`. Resolves with a line for the log. */
export function buildWordnet(dir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", SOURCE, dir], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim().split("\n").pop() || `the dictionary's builder stopped (${code})`));
    });
  });
}
