import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { listDocs } from "./docs";
import { DOCS_DIR } from "./paths";
import { arrange, sanitize, type Layout } from "./shelfLayout";

// The homepage's shelves: which book sits where. Books the file doesn't
// mention go on the first shelf, so losing it only loses the arrangement.
const SHELVES_FILE = path.join(DOCS_DIR, ".pen-shelves.json");

async function readLayout(): Promise<Layout | null> {
  try {
    return sanitize(JSON.parse(await readFile(SHELVES_FILE, "utf8")));
  } catch {
    return null; // missing or unreadable: every book on one shelf
  }
}

/** The shelves for these books (as listed by listDocs, newest first). */
export async function getShelves(bookIds: string[]): Promise<Layout> {
  return arrange(await readLayout(), bookIds);
}

let queue: Promise<unknown> = Promise.resolve();

/** Save an arrangement, fitted to the books that exist now. Returns what was saved. */
export function saveShelves(layout: Layout): Promise<Layout> {
  const run = queue.then(async () => {
    const fitted = arrange(layout, (await listDocs()).map((d) => d.id));
    await mkdir(DOCS_DIR, { recursive: true });
    const tmp = `${SHELVES_FILE}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(fitted, null, 2), "utf8");
    await rename(tmp, SHELVES_FILE);
    return fitted;
  });
  queue = run.catch(() => {});
  return run;
}
