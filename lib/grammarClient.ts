"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import { applyPatch, dictKey, effectiveRules, visibleFlags, type GrammarConfig, type GrammarPatch } from "./grammarConfig";
import type { Flag } from "./grammarText";
import { local } from "./storage";

// The page's side of the grammar checker, shared by every editor on the page:
// the library's settings, and the flags found so far, cached by block text so
// an unchanged paragraph is never asked for twice. The checking itself is the
// server's (POST /api/grammar/check, lib/grammarServer.ts), which remembers
// every paragraph it has checked, for every device.

const ENABLED_KEY = "pen:grammar";
const CACHE_LIMIT = 8000;

type Listener = () => void;

class GrammarService {
  private loading: Promise<void> | null = null;
  /** A settings change on its way to the server: checks wait for it. */
  private saving: Promise<unknown> = Promise.resolve();
  /** Bumped when the cache is cleared, so answers to older requests are dropped. */
  private generation = 0;
  private cache = new Map<string, Flag[]>();
  private listeners = new Set<Listener>();
  private dictionary = new Set<string>();
  private ignored = new Set<string>();
  config: GrammarConfig | null = null;
  enabled = false;
  /** The last check couldn't reach the server; the next edit tries again. */
  unreachable = false;

  constructor() {
    if (typeof window === "undefined") return;
    this.enabled = local.get(ENABLED_KEY) !== "off";
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
    local.set(ENABLED_KEY, on ? null : "off");
    this.emit();
  }

  private setUnreachable(value: boolean) {
    if (this.unreachable === value) return;
    this.unreachable = value;
    this.emit();
  }

  /** Flags already found for this text, filtered by the settings; undefined if not checked yet. */
  cached(text: string): Flag[] | undefined {
    const flags = this.cache.get(text);
    return flags && this.config ? visibleFlags(flags, this.config, this.dictionary, this.ignored) : undefined;
  }

  /** Check these texts (filling the cache). Resolves false if they couldn't be checked. */
  async check(texts: string[]): Promise<boolean> {
    try {
      await this.load();
      await this.saving;
      const generation = this.generation;
      const { flags } = await api<{ flags: Flag[][] }>("/api/grammar/check", { method: "POST", json: { texts } });
      this.setUnreachable(false);
      // Asked with settings since changed: the next pass asks again.
      if (generation !== this.generation) return true;
      texts.forEach((t, i) => {
        this.cache.delete(t);
        this.cache.set(t, flags[i]);
      });
      while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
      return true;
    } catch (err) {
      console.warn("grammar check failed:", err);
      this.setUnreachable(true);
      return false;
    }
  }

  /** Save a change to the library's settings, applied here right away. */
  async update(patch: GrammarPatch): Promise<void> {
    if (!this.config) await this.load();
    if (!this.config) return;
    this.setConfig(applyPatch(this.config, patch));
    const saving = (async () => {
      try {
        this.setConfig(await api<GrammarConfig>("/api/grammar", { method: "PATCH", json: patch }));
      } catch {}
    })();
    this.saving = Promise.all([this.saving, saving]);
    await saving;
  }

  /** Fetch the library's settings, once. */
  load(): Promise<void> {
    this.loading ??= (async () => {
      const config = await api<GrammarConfig>("/api/grammar");
      if (!this.config) this.setConfig(config);
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
      this.setConfig(await api<GrammarConfig>("/api/grammar"));
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
      if (stale) {
        this.cache.clear();
        this.generation++;
      }
    }
    this.emit();
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

/** Whether the last check couldn't reach the server. */
export function useGrammarUnreachable(): boolean {
  return useSyncExternalStore(
    (fn) => grammar.subscribe(fn),
    () => grammar.unreachable,
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
