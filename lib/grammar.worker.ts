/// <reference lib="webworker" />
import { LocalLinter } from "harper.js";
import { binary } from "harper.js/binary";
import type { Dialect } from "./grammarConfig";
import type { Flag } from "./grammarText";
import { configure, lintFlags } from "./harperFlags";

// Harper, off the main thread. Answers the page with plain data, so the WASM
// (and its 16 MB) is only ever loaded here.

export type WorkerRequest =
  | { id: number; type: "configure"; dialect: Dialect; rules: Record<string, boolean>; words: string[] }
  | { id: number; type: "lint"; texts: string[] };

export type WorkerResponse = { id: number; flags?: Flag[][]; error?: string };

const linter = new LocalLinter({ binary });

// One request at a time, in order.
let queue: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  queue = queue.then(async () => {
    let res: WorkerResponse;
    try {
      if (req.type === "configure") {
        await configure(linter, req.dialect, req.rules, req.words);
        res = { id: req.id };
      } else {
        const flags: Flag[][] = [];
        for (const t of req.texts) flags.push(await lintFlags(linter, t));
        res = { id: req.id, flags };
      }
    } catch (err) {
      res = { id: req.id, error: String(err) };
    }
    self.postMessage(res);
  });
};
