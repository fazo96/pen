// Which model Construct uses where, kept for the library in
// PEN_DIR/.pen-construct.json. A model is named with its agent,
// "claude:opus" or "pi:namyra/muse-glimmer-30b-q4"; unset is Claude Code's
// own default. Pure, so the server, the browser and tests can all use it.

import { DEFAULT_AGENT } from "./agentInfo.ts";

export const USES = ["chat", "transcribe", "quick"] as const;
export type ModelUse = (typeof USES)[number];

export type ModelSettings = Partial<Record<ModelUse, string>>;

/** One agent's models, as its model picker lists them; `error` when it couldn't be asked. */
export type AgentModels = { agent: string; name: string; models: { value: string; name: string }[]; error?: string };

export type ModelRef = { agent: string; model?: string };

/** "pi:namyra/x" → { agent: "pi", model: "namyra/x" }; unset → the default agent, its own default model. */
export function parseModel(ref: string | undefined): ModelRef {
  if (!ref) return { agent: DEFAULT_AGENT };
  const i = ref.indexOf(":");
  if (i < 0) return { agent: ref };
  return { agent: ref.slice(0, i), model: ref.slice(i + 1) || undefined };
}

export const modelRef = (agent: string, model?: string) => (model ? `${agent}:${model}` : agent);

export function sanitizeModelSettings(x: unknown): ModelSettings {
  const out: ModelSettings = {};
  if (!x || typeof x !== "object") return out;
  for (const use of USES) {
    const v = (x as Record<string, unknown>)[use];
    if (typeof v === "string" && /^[a-z]+(:[^\s]{1,200})?$/.test(v)) out[use] = v;
  }
  return out;
}
