"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import { type Dict, parseCompact } from "./prosody";
import { applyProsodyPatch, type OwnWord, type ProsodyConfig, type ProsodyPatch, wordKey } from "./prosody/own";

// The page's side of Cadence: the pronouncing dictionary (GET
// /api/pronunciations, about 1 MB gzipped, parsed once per page into a Map,
// ~0.3 s) and the writer's own pronunciations (/api/prosody), shared by the
// panel, the drawer's tab and /settings. Changes show at once and are saved
// behind; the server's answer is taken as the truth.

type Listener = () => void;

export type CadenceState = {
  status: "idle" | "loading" | "ready" | "failed";
  error: string | null;
  /** Once ready: the dictionary with the writer's words. A new object whenever those change. */
  dict: Dict | null;
  own: ProsodyConfig | null;
};

class CadenceService {
  state: CadenceState = { status: "idle", error: null, dict: null, own: null };
  private table: Map<string, string[]> | null = null;
  private loading: Promise<void> | null = null;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(next: Partial<CadenceState>) {
    const s = { ...this.state, ...next };
    if (this.table && s.own && (next.own || !s.dict)) {
      const table = this.table;
      s.dict = { lookup: (k) => table.get(k), own: s.own.words };
    }
    this.state = s;
    for (const fn of this.listeners) fn();
  }

  /** Fetch what isn't here yet; after a failure, try again. */
  load(): Promise<void> {
    if (this.state.status === "ready") return Promise.resolve();
    this.loading ??= (async () => {
      this.set({ status: "loading", error: null });
      try {
        const [text, own] = await Promise.all([
          this.table
            ? null
            : fetch("/api/pronunciations").then(async (res) => {
                if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `${res.status}`);
                return res.text();
              }),
          api<ProsodyConfig>("/api/prosody"),
        ]);
        if (text !== null) this.table = parseCompact(text);
        this.set({ status: "ready", own });
      } catch (err) {
        this.set({ status: "failed", error: (err as Error).message || "The pronouncing dictionary couldn’t be loaded." });
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  /** Fetch the writer's words again: Construct changed them. Nothing if they haven't been loaded here. */
  async reloadOwn(): Promise<void> {
    if (!this.state.own) return;
    const own = await api<ProsodyConfig>("/api/prosody").catch(() => null);
    if (own) this.set({ own });
  }

  /** The writer's words alone, without the dictionary (for /settings). */
  loadOwn(): Promise<void> {
    if (this.state.own) return Promise.resolve();
    this.owning ??= api<ProsodyConfig>("/api/prosody")
      .then((own) => this.set({ own }))
      .catch(() => {})
      .finally(() => (this.owning = null));
    return this.owning;
  }
  private owning: Promise<void> | null = null;

  private async patch(patch: ProsodyPatch) {
    if (this.state.own) this.set({ own: applyProsodyPatch(this.state.own, patch) });
    try {
      this.set({ own: await api<ProsodyConfig>("/api/prosody", { method: "PATCH", json: patch }) });
    } catch (err) {
      // Put back what the server has.
      this.set({ own: await api<ProsodyConfig>("/api/prosody").catch(() => this.state.own) });
      throw err;
    }
  }

  /** Say `word` the writer's way (replacing what they set before). */
  setWord(word: string, own: OwnWord): Promise<void> {
    return this.patch({ set: { word: wordKey(word), ...own } });
  }

  removeWord(word: string): Promise<void> {
    return this.patch({ remove: wordKey(word) });
  }
}

export const cadence = new CadenceService();

const IDLE: CadenceState = { status: "idle", error: null, dict: null, own: null };

/** Cadence's dictionary and the writer's words (or, `ownOnly`, just their words), loaded when first used. */
export function useCadence({ ownOnly = false } = {}): CadenceState {
  const state = useSyncExternalStore(
    (fn) => cadence.subscribe(fn),
    () => cadence.state,
    () => IDLE,
  );
  useEffect(() => {
    void (ownOnly ? cadence.loadOwn() : cadence.load());
  }, [ownOnly]);
  return state;
}
