import "server-only";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { wordCount } from "./text";

// Snapshots of one project's manuscript, kept in <project>/versions/ as plain
// markdown files. index.json holds what the file names can't: labels, kind
// and word counts. Callers serialize access (see lib/docs.ts).

export type VersionKind = "named" | "auto";
export type VersionMeta = { id: string; kind: VersionKind; label: string; created: number; words: number };

const MAX_AUTO = 30;
const VID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-\d+)?$/;

export function isValidVersionId(vid: string) {
  return VID_RE.test(vid);
}

const dirOf = (projectDir: string) => path.join(projectDir, "versions");
const indexOf = (projectDir: string) => path.join(dirOf(projectDir), "index.json");
const fileOf = (projectDir: string, vid: string) => path.join(dirOf(projectDir), `${vid}.md`);

async function writeAtomic(file: string, data: string) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data, "utf8");
  await rename(tmp, file);
}

export async function listVersions(projectDir: string): Promise<VersionMeta[]> {
  try {
    const list = JSON.parse(await readFile(indexOf(projectDir), "utf8")) as VersionMeta[];
    return list.sort((a, b) => b.created - a.created);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function saveIndex(projectDir: string, list: VersionMeta[]) {
  await writeAtomic(indexOf(projectDir), JSON.stringify(list, null, 2));
}

export async function readVersion(projectDir: string, vid: string): Promise<string | null> {
  if (!isValidVersionId(vid)) return null;
  try {
    return await readFile(fileOf(projectDir, vid), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Snapshot `content`, dated now unless `created` says otherwise (an imported
 * draft). Automatic snapshots are skipped when identical to the newest
 * version, and only the newest MAX_AUTO of them are kept.
 */
export async function addVersion(
  projectDir: string,
  content: string,
  kind: VersionKind,
  label: string,
  created = Date.now(),
): Promise<VersionMeta | null> {
  const list = await listVersions(projectDir);
  if (kind === "auto" && list[0] && (await readVersion(projectDir, list[0].id)) === content) return null;

  await mkdir(dirOf(projectDir), { recursive: true });
  const base = new Date(created).toISOString().replace(/[:.]/g, "-");
  let id = base;
  for (let i = 2; list.some((v) => v.id === id); i++) id = `${base}-${i}`;

  await writeAtomic(fileOf(projectDir, id), content);
  const meta: VersionMeta = { id, kind, label, created, words: wordCount(content) };
  const next = [meta, ...list];

  const autos = next.filter((v) => v.kind === "auto");
  const drop = new Set(autos.slice(MAX_AUTO).map((v) => v.id));
  for (const vid of drop) await unlink(fileOf(projectDir, vid)).catch(() => {});

  await saveIndex(projectDir, next.filter((v) => !drop.has(v.id)));
  return meta;
}

export async function deleteVersion(projectDir: string, vid: string): Promise<boolean> {
  const list = await listVersions(projectDir);
  if (!list.some((v) => v.id === vid)) return false;
  await unlink(fileOf(projectDir, vid)).catch(() => {});
  await saveIndex(projectDir, list.filter((v) => v.id !== vid));
  return true;
}

