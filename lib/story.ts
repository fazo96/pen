import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// The whole project is this one markdown file.
export const STORY_PATH = path.resolve(
  /*turbopackIgnore: true*/
  process.env.PEN_FILE ?? path.join(process.cwd(), "data", "story.md"),
);

const SEED = `# Untitled

Begin anywhere. The first heading becomes the title; every heading appears in the outline.

---

## Chapter One

`;

export type Story = { content: string; version: string };

export function versionOf(content: string): string {
  return createHash("sha1").update(content).digest("hex").slice(0, 12);
}

export async function readStory(): Promise<Story> {
  let content: string;
  try {
    content = await readFile(STORY_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    content = SEED;
    await writeAtomic(content);
  }
  return { content, version: versionOf(content) };
}

async function writeAtomic(content: string) {
  await mkdir(path.dirname(STORY_PATH), { recursive: true });
  const tmp = `${STORY_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, STORY_PATH);
}

// Serialize writes within this process so two requests can't interleave
// the read-compare-write below.
let queue: Promise<unknown> = Promise.resolve();

export type WriteResult =
  | { ok: true; version: string }
  | { ok: false; current: Story };

/**
 * Write the story if the caller's baseVersion still matches what's on disk.
 * `force` skips the check (used to resolve a conflict with "keep mine").
 */
export function writeStory(
  content: string,
  baseVersion: string | null,
  force = false,
): Promise<WriteResult> {
  const run = queue.then(async (): Promise<WriteResult> => {
    const current = await readStory();
    if (!force && baseVersion !== null && baseVersion !== current.version) {
      return { ok: false, current };
    }
    if (current.content !== content) await writeAtomic(content);
    return { ok: true, version: versionOf(content) };
  });
  queue = run.catch(() => {});
  return run;
}
