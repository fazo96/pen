// A JSON file holding something library-wide (.pen-shelves.json and the like):
// read through a sanitizer, so a missing, unreadable or hand-edited file reads
// as the default, and changed one update at a time, written whole. Imports
// nothing from pen but files and queue, so proxy.ts (through renames.ts) and
// plain-Node tests can use it.

import { readFile } from "node:fs/promises";
import { writeAtomic } from "./files.ts";
import { queue } from "./queue.ts";

export type JsonStore<T> = {
  read(): Promise<T>;
  /** Apply `change` to what's stored and save the result, which it returns. Returning `current` itself saves nothing. */
  update(change: (current: T) => T | Promise<T>): Promise<T>;
};

export function jsonStore<T>(file: string, parse: (raw: unknown) => T, fallback: () => T): JsonStore<T> {
  const read = async () => {
    try {
      return parse(JSON.parse(await readFile(file, "utf8")));
    } catch {
      return fallback();
    }
  };
  const serialize = queue(`json:${file}`);
  return {
    read,
    update: (change) =>
      serialize(async () => {
        const current = await read();
        const next = await change(current);
        if (next !== current) await writeAtomic(file, JSON.stringify(next, null, 2));
        return next;
      }),
  };
}
