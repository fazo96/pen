import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, stat, unlink, utimes } from "node:fs/promises";
import path from "node:path";
import { writeAtomic } from "./files.ts";
import type { Flag } from "./grammarText";

// Harper's flags per paragraph, kept on disk so a restart, another device or
// Construct never checks a paragraph twice. One file per settings signature
// (<signature>.jsonl, a line per paragraph: [hash of its text, flags]), read
// whole into memory when first used and appended to as paragraphs are
// checked. Past `limit` paragraphs the least recently used are dropped and the
// file written again. Files for the newest few other settings stay, so
// switching a rule off and on again doesn't mean checking everything again.
//
// Kept free of pen imports (types aside) so tests can load it with plain Node.

const FLUSH_MS = 1000;

const keyOf = (text: string) => createHash("sha1").update(text).digest("base64url");

export class FlagCache {
  private signature = "";
  private entries = new Map<string, Flag[]>();
  /** Lines in the file, counting ones a later line replaced. */
  private lines = 0;
  private opening: Promise<void> = Promise.resolve();
  private unsaved: string[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> = Promise.resolve();
  private warned = false;

  private dir: string;
  private limit: number;
  private keepOthers: number;

  constructor(dir: string, limit = 50_000, keepOthers = 3) {
    this.dir = dir;
    this.limit = limit;
    this.keepOthers = keepOthers;
  }

  private file(signature = this.signature) {
    return path.join(this.dir, `${signature}.jsonl`);
  }

  /** Switch to these settings' file (a no-op if already on it). Wait before get/set. */
  use(signature: string): Promise<void> {
    if (signature === this.signature) return this.opening;
    const previous = this.signature;
    this.signature = signature;
    this.opening = (async () => {
      if (previous) await this.flush(previous);
      this.entries = new Map();
      this.lines = 0;
      try {
        const raw = await readFile(this.file(), "utf8");
        const now = new Date();
        await utimes(this.file(), now, now).catch(() => {});
        for (const line of raw.split("\n")) {
          if (!line) continue;
          try {
            const [key, flags] = JSON.parse(line) as [string, Flag[]];
            this.entries.delete(key);
            this.entries.set(key, flags);
            this.lines++;
          } catch {} // a line cut short by a crash
        }
        this.trim();
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") this.warn(err);
      }
      await this.prune();
    })();
    return this.opening;
  }

  /** Flags found before for this text, if any. */
  get(text: string): Flag[] | undefined {
    const key = keyOf(text);
    const flags = this.entries.get(key);
    if (flags) {
      // Recently used last: what goes when the cache is full is what's gone from the books.
      this.entries.delete(key);
      this.entries.set(key, flags);
    }
    return flags;
  }

  set(text: string, flags: Flag[]) {
    const key = keyOf(text);
    this.entries.delete(key);
    this.entries.set(key, flags);
    this.trim();
    this.unsaved.push(JSON.stringify([key, flags]));
    this.timer ??= setTimeout(() => void this.flush(), FLUSH_MS);
    this.timer.unref?.();
  }

  get size() {
    return this.entries.size;
  }

  private trim() {
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
  }

  /** Write what's unsaved; once the file holds half again what's kept, write it anew. */
  flush(signature = this.signature): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const lines = this.unsaved;
    this.unsaved = [];
    const entries = this.entries;
    this.writing = this.writing.then(async () => {
      if (!lines.length || !signature) return;
      const file = this.file(signature);
      try {
        await mkdir(this.dir, { recursive: true });
        this.lines += lines.length;
        if (this.lines > this.limit * 1.5 && entries === this.entries) {
          const all = [...entries].map((e) => JSON.stringify(e));
          await writeAtomic(file, all.join("\n") + "\n");
          this.lines = all.length;
        } else {
          await appendFile(file, lines.join("\n") + "\n");
        }
      } catch (err) {
        this.warn(err);
      }
    });
    return this.writing;
  }

  /** Delete the files of all but the newest few other settings. */
  private async prune() {
    try {
      const names = (await readdir(this.dir)).filter((n) => n.endsWith(".jsonl") && n !== `${this.signature}.jsonl`);
      const dated = await Promise.all(
        names.map(async (n) => ({ n, t: (await stat(path.join(this.dir, n)).catch(() => null))?.mtimeMs ?? 0 })),
      );
      dated.sort((a, b) => b.t - a.t);
      for (const { n } of dated.slice(this.keepOthers)) await unlink(path.join(this.dir, n)).catch(() => {});
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") this.warn(err);
    }
  }

  // A cache that can't be written still works, from memory.
  private warn(err: unknown) {
    if (this.warned) return;
    this.warned = true;
    console.warn("grammar cache:", err);
  }
}
