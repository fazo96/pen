"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import type { AgentModels } from "./construct/models";

// The agents Construct can run on here and their models, asked once per page
// load (the server keeps them for 10 minutes too: asking starts each agent).

let cached: Promise<AgentModels[]> | null = null;

export function fetchModels(fresh = false): Promise<AgentModels[]> {
  if (!cached || fresh) {
    cached = api<AgentModels[]>(`/api/construct/models${fresh ? "?fresh" : ""}`).catch(() => {
      throw new Error("Couldn’t list the models.");
    });
    cached.catch(() => (cached = null));
  }
  return cached;
}

/** The models on offer; null while they're being asked for. `enabled` false waits. */
export function useModels(enabled = true): { agents: AgentModels[] | null; error: string | null; refresh: () => void } {
  const [agents, setAgents] = useState<AgentModels[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setError(null);
    fetchModels(fresh > 0)
      .then((a) => live && setAgents(a))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [enabled, fresh]);
  return { agents, error, refresh: () => setFresh((n) => n + 1) };
}
