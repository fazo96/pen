// Where renamed projects went: PEN_DIR/.pen-renames.json, { old id: current id }.
//
// No "server-only" import: proxy.ts runs outside the RSC graph and redirects
// old ids with it. Nothing here is ever imported by client code.
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isValidId } from "./ids";
import { DOCS_DIR } from "./paths";
import { type Renames, withRename } from "./renameMap";

const RENAMES_FILE = path.join(DOCS_DIR, ".pen-renames.json");

export async function readRenames(): Promise<Renames> {
  try {
    const data = JSON.parse(await readFile(RENAMES_FILE, "utf8")) as unknown;
    if (!data || typeof data !== "object") return {};
    return Object.fromEntries(
      Object.entries(data).filter(([k, v]) => isValidId(k) && isValidId(v)),
    );
  } catch {
    return {};
  }
}

/** Remember that `from` is now `to`. Called by lib/docs.ts's renameDoc, inside its queue. */
export async function recordRename(from: string, to: string): Promise<void> {
  const next = withRename(await readRenames(), from, to);
  await mkdir(DOCS_DIR, { recursive: true });
  const tmp = `${RENAMES_FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await rename(tmp, RENAMES_FILE);
}

const exists = (p: string) => stat(p).then(
  () => true,
  () => false,
);

/** The current id of a project renamed away from `id`, or null (also when `id` is a project itself). */
export async function renamedTo(id: string): Promise<string | null> {
  if (!isValidId(id) || (await exists(path.join(DOCS_DIR, id)))) return null;
  const to = (await readRenames())[id];
  return to && (await exists(path.join(DOCS_DIR, to, "manuscript.md"))) ? to : null;
}
