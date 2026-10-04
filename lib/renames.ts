// Where renamed projects went: PEN_DIR/.pen-renames.json, { old id: current id }.
//
// No "server-only" import: proxy.ts runs outside the RSC graph and redirects
// old ids with it. Nothing here is ever imported by client code.
import { stat } from "node:fs/promises";
import path from "node:path";
import { isValidId } from "./ids";
import { jsonStore } from "./jsonStore";
import { DOCS_DIR } from "./paths";
import { type Renames, withRename } from "./renameMap";

const store = jsonStore<Renames>(
  path.join(DOCS_DIR, ".pen-renames.json"),
  (data) =>
    data && typeof data === "object"
      ? Object.fromEntries(Object.entries(data).filter(([k, v]) => isValidId(k) && isValidId(v)))
      : {},
  () => ({}),
);

export const readRenames = (): Promise<Renames> => store.read();

/** Remember that `from` is now `to`. Called by lib/docs.ts's renameDoc, inside its queue. */
export async function recordRename(from: string, to: string): Promise<void> {
  await store.update((r) => withRename(r, from, to));
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
