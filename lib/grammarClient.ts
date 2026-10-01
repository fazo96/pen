"use client";

import { useEffect, useSyncExternalStore } from "react";
import { applyPatch, dictKey, effectiveRules, visibleFlags, type GrammarConfig, type GrammarPatch } from "./grammarConfig";
import type { Flag } from "./grammarText";
import type { WorkerRequest, WorkerResponse } from "./grammar.worker";

// The page's side of the grammar checker, shared by every editor on the page:
// the worker, the library's settings, and the flags found so far, cached by
// block text so an unchanged paragraph is never checked twice.

const ENABLED_KEY = "pen:grammar";
const CACHE_LIMIT = 8000;

type Listener = () => void;
type Request = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, "id"> : never) : never;

class GrammarService {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: WorkerResponse) => void }>();
  private configuring: Promise<void> | null = null;
  private loading: Promise<void> | null = null;
  private cache = new Map<string, Flag[]>();
  private listeners = new Set<Listener>();
  private dictionary = new Set<string>();
  private ignored = new Set<string>();
  config: GrammarConfig | null = null;
  enabled = false;
  failed = false;

  constructor() {
    if (typeof window === "undefined") return;
    try {
      this.enabled = localStorage.getItem(ENABLED_KEY) !== "off";
    } catch {
      this.enabled = true;
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try {
      if (on) localStorage.removeItem(ENABLED_KEY);
      else localStorage.setItem(ENABLED_KEY, "off");
    } catch {}
    this.emit();
  }

  /** Flags already found for this text, filtered by the settings; undefined if not checked yet. */
  cached(text: string): Flag[] | undefined {
    const flags = this.cache.get(text);
    return flags && this.config ? visibleFlags(flags, this.config, this.dictionary, this.ignored) : undefined;
  }

  /** Check these texts (filling the cache). Resolves false if the checker can't run. */
  async check(texts: string[]): Promise<boolean> {
    if (!(await this.ready())) return false;
    const res = await this.send({ type: "lint", texts });
    if (!res.flags) {
      console.warn("grammar check failed:", res.error);
      return false;
    }
    texts.forEach((t, i) => {
      this.cache.delete(t);
      this.cache.set(t, res.flags![i]);
    });
    while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    return true;
  }

  /** Save a change to the library's settings, applied here right away. */
  async update(patch: GrammarPatch): Promise<void> {
    if (!this.config) await this.load();
    if (!this.config) return;
    this.setConfig(applyPatch(this.config, patch));
    try {
      const res = await fetch("/api/grammar", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) this.setConfig(await res.json());
    } catch {}
  }

  /** Fetch the library's settings, once. */
  load(): Promise<void> {
    this.loading ??= (async () => {
      const res = await fetch("/api/grammar");
      if (!res.ok) throw new Error(`settings: ${res.status}`);
      if (!this.config) this.setConfig(await res.json());
    })().catch((err) => {
      this.loading = null;
      throw err;
    });
    return this.loading;
  }

  /** Pick up changes made on another device. */
  async refresh(): Promise<void> {
    if (!this.config) return;
    try {
      const res = await fetch("/api/grammar");
      if (res.ok) this.setConfig(await res.json());
    } catch {}
  }

  private setConfig(next: GrammarConfig) {
    const prev = this.config;
    this.config = next;
    this.dictionary = new Set(next.words.map(dictKey));
    this.ignored = new Set(next.ignored);
    if (prev) {
      // Flags for newly enabled rules, removed words or another dialect were
      // never looked for: check everything again. Anything else is a filter.
      const on = (c: GrammarConfig) => new Set(Object.entries(effectiveRules(c)).filter(([, v]) => v).map(([k]) => k));
      const prevOn = on(prev);
      const words = new Set(next.words.map(dictKey));
      const stale =
        prev.dialect !== next.dialect ||
        [...on(next)].some((r) => !prevOn.has(r)) ||
        prev.words.some((w) => !words.has(dictKey(w)));
      if (stale) this.cache.clear();
      if (this.worker) {
        this.configuring = this.configure().catch((err) => console.warn("grammar settings not applied:", err));
      }
    }
    this.emit();
  }

  private configure(): Promise<void> {
    const c = this.config!;
    return this.send({ type: "configure", dialect: c.dialect, rules: effectiveRules(c), words: c.words }).then((r) => {
      if (r.error) throw new Error(r.error);
    });
  }

  private ready(): Promise<boolean> {
    if (this.failed) return Promise.resolve(false);
    if (!this.configuring) {
      this.configuring = (async () => {
        await this.load();
        this.worker = new Worker(new URL("./grammar.worker.ts", import.meta.url), { type: "module" });
        this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
          const p = this.pending.get(e.data.id);
          this.pending.delete(e.data.id);
          p?.resolve(e.data);
        };
        this.worker.onerror = (e) => {
          console.warn("grammar worker failed:", e.message);
          this.failed = true;
          for (const p of this.pending.values()) p.resolve({ id: -1, error: "worker failed" });
          this.pending.clear();
          this.emit();
        };
        await this.configure();
      })();
    }
    return this.configuring.then(
      () => !this.failed,
      (err) => {
        console.warn("grammar checker unavailable:", err);
        this.configuring = null; // try again next time
        return false;
      },
    );
  }

  private send(req: Request): Promise<WorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      this.worker!.postMessage({ ...req, id });
    });
  }
}

export const grammar = new GrammarService();

/** Whether the grammar checker is on (on this device), kept in step with every toggle. */
export function useGrammarEnabled(): boolean {
  return useSyncExternalStore(
    (fn) => grammar.subscribe(fn),
    () => grammar.enabled,
    () => false,
  );
}

/** The library's grammar settings, once loaded. */
export function useGrammarConfig(): GrammarConfig | null {
  const config = useSyncExternalStore(
    (fn) => grammar.subscribe(fn),
    () => grammar.config,
    () => null,
  );
  useEffect(() => {
    grammar.load().catch(() => {});
  }, []);
  return config;
}
