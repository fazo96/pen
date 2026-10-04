import "server-only";
import { writeAtomic } from "../files";
import type { Doc } from "../types";
import * as versions from "../versions";
import { dirOf, fileOf, projectExists, readDoc, ready, serialize, versionOf } from "./core";

// The manuscript's saved versions (lib/versions.ts keeps them in
// <project>/versions/), through the library's queue.

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
    await writeAtomic(fileOf(id), content);
    return { id, content, version: versionOf(content) };
  });
}

export function deleteVersion(id: string, vid: string) {
  return serialize(() => versions.deleteVersion(dirOf(id), vid));
}

export function renameVersion(id: string, vid: string, label: string) {
  return serialize(() => versions.renameVersion(dirOf(id), vid, label));
}
