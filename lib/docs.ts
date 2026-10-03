import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DOCS_DIR } from "./paths";
import { recordRename } from "./renames";
import { droppedEntry, noSpots, renamedEntry, sanitizeSpots, type Spot, type Spots, withLast, withSpot } from "./spot";
import { slugify, titleOf, wordCount } from "./text";
import * as versions from "./versions";

// The library: one folder per project, holding manuscript.md (the master
// copy), versions/ and codex/. Room for more per-project files later.
const MANUSCRIPT = "manuscript.md";
const TRASH_DIR = path.join(DOCS_DIR, ".trash");

// The first save after this much quiet snapshots the text as it was before.
const SESSION_GAP_MS = Number(process.env.PEN_SESSION_GAP_MS) || 30 * 60 * 1000;

export const MAX_BYTES = 5 * 1024 * 1024;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

export type Doc = { id: string; content: string; version: string };
export type DocMeta = {
  id: string;
  title: string;
  words: number;
  /** Last written: the manuscript or any Codex entry. */
  modified: number;
  /** mtime of the cover image, to cache-bust its URL; null without one. */
  cover: number | null;
};
export type { VersionMeta } from "./versions";

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

function dirOf(id: string) {
  if (!isValidId(id)) throw new Error(`invalid id: ${id}`);
  return path.join(DOCS_DIR, id);
}
const fileOf = (id: string) => path.join(dirOf(id), MANUSCRIPT);

export function versionOf(content: string): string {
  return createHash("sha1").update(content).digest("hex").slice(0, 12);
}

function isMissing(err: unknown) {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}

// All mutations run through one queue so read-compare-write never interleaves.
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(ready).then(fn);
  queue = run.catch(() => {});
  return run;
}

// One-time move from the old flat layout (data/<id>.md) to data/<id>/manuscript.md.
let migrated: Promise<void> | null = null;
function ready(): Promise<void> {
  migrated ??= (async () => {
    let names: string[];
    try {
      names = await readdir(DOCS_DIR);
    } catch (err) {
      if (isMissing(err)) return;
      throw err;
    }
    for (const n of names) {
      const id = n.slice(0, -3);
      if (!n.endsWith(".md") || !isValidId(id)) continue;
      try {
        await mkdir(dirOf(id)); // fails if the folder already exists: leave both alone
      } catch {
        continue;
      }
      await rename(path.join(DOCS_DIR, n), fileOf(id));
    }
  })().catch((err) => {
    migrated = null; // retry on the next call
    throw err;
  });
  return migrated;
}

/** When a Codex entry was last written; 0 without any. */
async function lastCodexEdit(id: string): Promise<number> {
  let names: string[];
  try {
    names = await readdir(codexDir(id));
  } catch (err) {
    if (isMissing(err)) return 0;
    throw err;
  }
  const times = await Promise.all(
    names
      .filter((n) => n.endsWith(".md"))
      .map((n) =>
        stat(path.join(codexDir(id), n)).then(
          (s) => s.mtimeMs,
          () => 0, // deleted meanwhile
        ),
      ),
  );
  return Math.max(0, ...times);
}

/** Every project, the most recently written first (the manuscript or any Codex entry). */
export async function listDocs(): Promise<DocMeta[]> {
  await ready();
  let entries;
  try {
    entries = await readdir(DOCS_DIR, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  const docs = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && isValidId(e.name))
      .map(async ({ name: id }): Promise<DocMeta | null> => {
        try {
          const file = fileOf(id);
          const [content, info, cover, codex] = await Promise.all([
            readFile(file, "utf8"),
            stat(file),
            findCover(id),
            lastCodexEdit(id),
          ]);
          return {
            id,
            title: titleOf(content, id),
            words: wordCount(content),
            modified: Math.max(info.mtimeMs, codex),
            cover: cover?.mtime ?? null,
          };
        } catch (err) {
          if (isMissing(err)) return null; // not a project, or deleted meanwhile
          throw err;
        }
      }),
  );
  return docs.filter((d): d is DocMeta => d !== null).sort((a, b) => b.modified - a.modified);
}

export async function readDoc(id: string): Promise<Doc | null> {
  if (!isValidId(id)) return null;
  await ready();
  try {
    const content = await readFile(fileOf(id), "utf8");
    return { id, content, version: versionOf(content) };
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

async function writeAtomic(id: string, content: string) {
  await atomicWrite(fileOf(id), content);
}

async function atomicWrite(file: string, content: string | Uint8Array) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

/** Create a new project, naming its folder after `name` (or its H1). */
export function createDoc(content: string, name?: string): Promise<Doc> {
  return serialize(async () => {
    await mkdir(DOCS_DIR, { recursive: true });
    const base = slugify(name || titleOf(content, "")) || "untitled";
    for (let i = 1; ; i++) {
      const id = `${base.slice(0, 72)}${i > 1 ? `-${i}` : ""}`;
      try {
        await mkdir(dirOf(id)); // fails if taken, so we never write into a sibling
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw err;
      }
      await writeFile(fileOf(id), content, "utf8");
      return { id, content, version: versionOf(content) };
    }
  });
}

/**
 * A save based on an older version than the file's, unless the file already holds
 * exactly this text: then it overwrites nothing. That happens when one change arrives
 * twice, as when a page being left saves it and the next one sends its backup.
 */
function stale(current: { content: string; version: string } | null, content: string, baseVersion: string | null, force: boolean): boolean {
  return !!current && !force && baseVersion !== null && baseVersion !== current.version && current.content !== content;
}

export type WriteResult = { ok: true; version: string } | { ok: false; current: Doc };

/**
 * Write a manuscript if the caller's baseVersion still matches what's on disk.
 * `force` skips the check (used to resolve a conflict with "keep mine").
 * A project deleted elsewhere is recreated rather than losing the writing.
 */
export function writeDoc(
  id: string,
  content: string,
  baseVersion: string | null,
  force = false,
): Promise<WriteResult> {
  return serialize(async () => {
    const current = await readDoc(id);
    if (stale(current, content, baseVersion, force)) return { ok: false, current: current! };
    if (current?.content !== content) {
      if (current) {
        const { mtimeMs } = await stat(fileOf(id));
        if (Date.now() - mtimeMs >= SESSION_GAP_MS) {
          await versions.addVersion(dirOf(id), current.content, "auto", "Session start");
        }
      }
      await writeAtomic(id, content);
    }
    return { ok: true, version: versionOf(content) };
  });
}

/** Move a whole project (manuscript and versions) to .trash/. False if missing. */
export function trashDoc(id: string): Promise<boolean> {
  return serialize(async () => {
    await mkdir(TRASH_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      await stat(fileOf(id));
      await rename(dirOf(id), path.join(TRASH_DIR, `${id}--${stamp}`));
      return true;
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  });
}

export type RenameResult = "ok" | "missing" | "taken" | "invalid";

/**
 * Give a project a new id (its folder, and its URLs). The old id is recorded
 * so links, and editors still open under it, reach the project at its new one.
 */
export function renameDoc(id: string, to: string): Promise<RenameResult> {
  if (!isValidId(id) || !isValidId(to)) return Promise.resolve("invalid");
  return serialize(async () => {
    if (!(await projectExists(id))) return "missing";
    if (id === to) return "ok";
    try {
      await stat(dirOf(to)); // rename() would happily replace an empty folder
      return "taken";
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
    // A project that has talked to Construct keeps its agent's folder name, and with it the agent's memory.
    try {
      await stat(chatsDir(id));
      await pinAgentHome(id);
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
    await rename(dirOf(id), dirOf(to));
    await recordRename(id, to);
    return "ok";
  });
}

// ─── Spot ────────────────────────────────────────────────────
// Where the writer last was in the manuscript and in each Codex entry, and the
// entry viewed last (lib/spot.ts): <project>/spot.json.

const spotFile = (id: string) => path.join(dirOf(id), "spot.json");

export async function readSpots(id: string): Promise<Spots> {
  if (!isValidId(id)) return noSpots();
  try {
    return sanitizeSpots(JSON.parse(await readFile(spotFile(id), "utf8")));
  } catch {
    return noSpots(); // none yet, or unreadable: open at the top
  }
}

/** Unserialized: callers hold the queue. Written only when it changes. */
async function updateSpots(id: string, change: (s: Spots) => Spots) {
  const before = await readSpots(id);
  const after = change(before);
  if (JSON.stringify(after) !== JSON.stringify(before)) await atomicWrite(spotFile(id), JSON.stringify(after));
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
    if (entry !== null && !(await readEntry(id, entry))) return false;
    await updateSpots(id, (s) => (spot ? withSpot(s, entry, spot) : entry ? withLast(s, entry) : s));
    return true;
  });
}

// ─── Cover ───────────────────────────────────────────────────
// The book's cover art: <project>/cover.<ext>, at most one.

export const MAX_COVER_BYTES = 10 * 1024 * 1024;
const COVER_TYPES = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
} as const;
export type CoverExt = keyof typeof COVER_TYPES;
const coverFile = (id: string, ext: CoverExt) => path.join(dirOf(id), `cover.${ext}`);

/** Sniff the format from the first bytes; the name and MIME type sent can't be trusted. */
export function coverExtOf(data: Uint8Array): CoverExt | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...data.subarray(from, to));
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12))) return "avif";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "gif";
  return null;
}

async function findCover(id: string): Promise<{ file: string; ext: CoverExt; mtime: number } | null> {
  for (const ext of Object.keys(COVER_TYPES) as CoverExt[]) {
    const file = coverFile(id, ext);
    try {
      return { file, ext, mtime: (await stat(file)).mtimeMs };
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }
  return null;
}

export async function readCover(id: string): Promise<{ data: Buffer; type: string } | null> {
  if (!isValidId(id)) return null;
  await ready();
  const cover = await findCover(id);
  if (!cover) return null;
  try {
    return { data: await readFile(coverFile(id, cover.ext)), type: COVER_TYPES[cover.ext] };
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

async function trashCover(id: string): Promise<boolean> {
  const cover = await findCover(id);
  if (!cover) return false;
  await mkdir(TRASH_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await rename(cover.file, path.join(TRASH_DIR, `${id}--cover--${stamp}.${cover.ext}`));
  return true;
}

/** Set a project's cover, trashing the old one. False if the project is missing. */
export function writeCover(id: string, data: Uint8Array, ext: CoverExt): Promise<boolean> {
  return serialize(async () => {
    if (!(await projectExists(id))) return false;
    await trashCover(id);
    await atomicWrite(coverFile(id, ext), data);
    return true;
  });
}

/** Move a project's cover to .trash/. False if it had none. */
export function removeCover(id: string): Promise<boolean> {
  return serialize(() => trashCover(id));
}

// ─── Versions ────────────────────────────────────────────────

export async function listVersions(id: string) {
  await ready();
  return versions.listVersions(dirOf(id));
}

export async function readVersion(id: string, vid: string) {
  await ready();
  return versions.readVersion(dirOf(id), vid);
}

/** Snapshot the manuscript as it is on disk now. Null if the project is missing. */
export function saveVersion(id: string, label: string) {
  return serialize(async () => {
    const current = await readDoc(id);
    if (!current) return null;
    return versions.addVersion(dirOf(id), current.content, "named", label);
  });
}

/** Add an older draft from elsewhere as a named version, dated `created`. Null if the project is missing. */
export function importVersion(id: string, content: string, label: string, created: number) {
  return serialize(async () => {
    if (!(await projectExists(id))) return null;
    return versions.addVersion(dirOf(id), content, "named", label, created);
  });
}

/** Replace the manuscript with a version, snapshotting the current text first. */
export function restoreVersion(id: string, vid: string): Promise<Doc | null> {
  return serialize(async () => {
    const [current, content] = await Promise.all([readDoc(id), versions.readVersion(dirOf(id), vid)]);
    if (!current || content === null) return null;
    await versions.addVersion(dirOf(id), current.content, "auto", "Before restore");
    await writeAtomic(id, content);
    return { id, content, version: versionOf(content) };
  });
}

export function deleteVersion(id: string, vid: string) {
  return serialize(() => versions.deleteVersion(dirOf(id), vid));
}

export function renameVersion(id: string, vid: string, label: string) {
  return serialize(() => versions.renameVersion(dirOf(id), vid, label));
}

// ─── Codex ───────────────────────────────────────────────────
// Notes that sit beside the manuscript: <project>/codex/<entry>.md.

export type EntryMeta = { id: string; title: string; words: number; modified: number };

const codexDir = (id: string) => path.join(dirOf(id), "codex");
function entryFile(id: string, eid: string) {
  if (!isValidId(eid)) throw new Error(`invalid entry id: ${eid}`);
  return path.join(codexDir(id), `${eid}.md`);
}

async function projectExists(id: string) {
  return (await readDoc(id)) !== null;
}

/** Entries in alphabetical order of title; null if the project doesn't exist. */
export async function listCodex(id: string): Promise<EntryMeta[] | null> {
  if (!isValidId(id) || !(await projectExists(id))) return null;
  let names: string[];
  try {
    names = await readdir(codexDir(id));
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  const entries = await Promise.all(
    names
      .filter((n) => n.endsWith(".md") && isValidId(n.slice(0, -3)))
      .map(async (n): Promise<EntryMeta | null> => {
        const eid = n.slice(0, -3);
        try {
          const file = entryFile(id, eid);
          const [content, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
          return { id: eid, title: titleOf(content, eid), words: wordCount(content), modified: info.mtimeMs };
        } catch (err) {
          if (isMissing(err)) return null;
          throw err;
        }
      }),
  );
  return entries
    .filter((e): e is EntryMeta => e !== null)
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

export async function readEntry(id: string, eid: string): Promise<Doc | null> {
  if (!isValidId(id) || !isValidId(eid)) return null;
  await ready();
  try {
    const content = await readFile(entryFile(id, eid), "utf8");
    return { id: eid, content, version: versionOf(content) };
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

/** Create an entry named after `name` (or its H1). Null if the project doesn't exist. */
export function createEntry(id: string, content: string, name?: string): Promise<Doc | null> {
  return serialize(async () => {
    if (!(await projectExists(id))) return null;
    await mkdir(codexDir(id), { recursive: true });
    const base = slugify(name || titleOf(content, "")) || "entry";
    for (let i = 1; ; i++) {
      const eid = `${base.slice(0, 72)}${i > 1 ? `-${i}` : ""}`;
      try {
        await writeFile(entryFile(id, eid), content, { encoding: "utf8", flag: "wx" });
        return { id: eid, content, version: versionOf(content) };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
  });
}

/** Same contract as writeDoc, for a codex entry (no automatic versions). */
export function writeEntry(
  id: string,
  eid: string,
  content: string,
  baseVersion: string | null,
  force = false,
): Promise<WriteResult> {
  return serialize(async () => {
    const current = await readEntry(id, eid);
    if (stale(current, content, baseVersion, force)) return { ok: false, current: current! };
    if (current?.content !== content) await atomicWrite(entryFile(id, eid), content);
    return { ok: true, version: versionOf(content) };
  });
}

export function trashEntry(id: string, eid: string): Promise<boolean> {
  return serialize(async () => {
    await mkdir(TRASH_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      await rename(entryFile(id, eid), path.join(TRASH_DIR, `${id}--codex--${eid}--${stamp}.md`));
      await updateSpots(id, (s) => droppedEntry(s, eid));
      return true;
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  });
}

/** Give an entry a new id (its file name). False if missing or the new id is taken. */
export function renameEntry(id: string, eid: string, newEid: string): Promise<boolean> {
  return serialize(async () => {
    const from = entryFile(id, eid);
    const to = entryFile(id, newEid);
    try {
      await stat(to);
      return false;
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
    try {
      await rename(from, to);
      await updateSpots(id, (s) => renamedEntry(s, eid, newEid));
      return true;
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  });
}

// ─── Construct chats ─────────────────────────────────────────
// Conversations with Construct: <project>/construct/<chat>.json, written by
// lib/construct/session.ts. Opaque JSON here.

const chatsDir = (id: string) => path.join(dirOf(id), "construct");
function chatFile(id: string, cid: string) {
  if (!isValidId(cid)) throw new Error(`invalid chat id: ${cid}`);
  return path.join(chatsDir(id), `${cid}.json`);
}

/** Every stored chat of a project, parsed; unreadable files are skipped. */
export async function readChats(id: string): Promise<unknown[]> {
  if (!isValidId(id)) return [];
  await ready();
  let names: string[];
  try {
    names = await readdir(chatsDir(id));
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  const chats = await Promise.all(
    names
      .filter((n) => n.endsWith(".json") && isValidId(n.slice(0, -5)))
      .map(async (n) => {
        try {
          return JSON.parse(await readFile(chatFile(id, n.slice(0, -5)), "utf8")) as unknown;
        } catch {
          return null;
        }
      }),
  );
  return chats.filter((c) => c !== null);
}

// The agent runs in a scratch folder named for the project, and Claude Code
// files its sessions under that path. The name is fixed the first time, so a
// renamed project's chats can still be resumed.
const agentHomeFile = (id: string) => path.join(chatsDir(id), "agent-home");

async function pinAgentHome(id: string): Promise<string> {
  try {
    const name = (await readFile(agentHomeFile(id), "utf8")).trim();
    if (isValidId(name)) return name;
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  await atomicWrite(agentHomeFile(id), id);
  return id;
}

/** The name of Construct's working folder for this project. */
export function agentHome(id: string): Promise<string> {
  return serialize(async () => ((await projectExists(id)) ? pinAgentHome(id) : id));
}

/** Save a chat. False if the project no longer exists. */
export function writeChat(id: string, cid: string, data: unknown): Promise<boolean> {
  return serialize(async () => {
    if (!(await projectExists(id))) return false;
    await atomicWrite(chatFile(id, cid), JSON.stringify(data));
    return true;
  });
}

export function trashChat(id: string, cid: string): Promise<boolean> {
  return serialize(async () => {
    await mkdir(TRASH_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      await rename(chatFile(id, cid), path.join(TRASH_DIR, `${id}--construct--${cid}--${stamp}.json`));
      return true;
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  });
}
