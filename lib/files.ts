// Writing files so a crash or a full disk never leaves one half-written: the
// data goes to a temporary file beside it (*.tmp, which exports skip), then
// takes its place in one step. Imports nothing from pen, so proxy.ts (through
// auth.ts and renames.ts) and plain-Node tests can use it.

import { randomBytes } from "node:crypto";
import { link, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const tmpFor = (file: string) => `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;

async function writeTmp(file: string, data: string | Uint8Array, mode?: number): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = tmpFor(file);
  try {
    await writeFile(tmp, data, { encoding: "utf8", mode });
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  return tmp;
}

/** Replace `file` (or create it, and its folder) with `data`, whole or not at all. */
export async function writeAtomic(file: string, data: string | Uint8Array, { mode }: { mode?: number } = {}): Promise<void> {
  const tmp = await writeTmp(file, data, mode);
  try {
    await rename(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Create `file` with `data`, whole or not at all; false if it already exists. */
export async function createExclusive(file: string, data: string | Uint8Array): Promise<boolean> {
  const tmp = await writeTmp(file, data);
  try {
    await link(tmp, file); // unlike rename, fails if the name is taken
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}
