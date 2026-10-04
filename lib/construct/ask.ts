import "server-only";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import os from "node:os";
import path from "node:path";
import { type AgentLaunch, probeModels, runOnce } from "../oneoff";
import { type AgentId, type AgentPreset, AGENTS, availableAgents, isAgentId } from "./agents";
import { type AgentModels, type ModelUse, parseModel } from "./models";
import { getModelSettings } from "./settings";

// One-off questions (transcribing a note, the look-up buttons) on the model
// the settings choose for them, and the list of models to choose from.

const MCP_NAME = "pen";
// Not a project id (those can't start with a dot), so never one of Construct's homes.
const CWD = path.join(os.tmpdir(), "pen-construct", ".oneoff");

/** How to start `agent` with no tools and `systemPrompt`. */
async function launchFor(agent: AgentId, systemPrompt: string): Promise<AgentLaunch> {
  const preset: AgentPreset = AGENTS[agent];
  const ctx = { cwd: CWD, systemPrompt };
  return {
    command: preset.command,
    cwd: CWD,
    env: await preset.env?.(ctx, MCP_NAME),
    sessionMeta: preset.sessionMeta(ctx, MCP_NAME),
  };
}

/** The agent and model set for `use`; an agent that can't run here falls back to the default. */
export async function modelFor(use: ModelUse): Promise<{ agent: AgentId; model?: string }> {
  const { agent, model } = parseModel((await getModelSettings())[use]);
  if (isAgentId(agent) && AGENTS[agent].available()) return { agent, model };
  return { agent: "claude" };
}

export async function askOnce(
  use: ModelUse,
  opts: {
    systemPrompt: string;
    prompt: ContentBlock[];
    onText?: (text: string) => void;
    onThought?: (text: string) => void;
    signal?: AbortSignal;
  },
): Promise<string> {
  const { agent, model } = await modelFor(use);
  const { systemPrompt, ...ask } = opts;
  return runOnce({ launch: await launchFor(agent, systemPrompt), model, ...ask });
}

// ─── The models on offer ─────────────────────────────────────

const CACHE_MS = 10 * 60_000;
let cached: { at: number; list: Promise<AgentModels[]> } | null = null;

/** Every agent that can run here, with its models; asked once every 10 minutes. */
export function listModels(fresh = false): Promise<AgentModels[]> {
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.list;
  const list = Promise.all(
    availableAgents().map(async (agent): Promise<AgentModels> => {
      const { name } = AGENTS[agent];
      try {
        return { agent, name, models: await probeModels(await launchFor(agent, "You are Construct.")) };
      } catch (err) {
        return { agent, name, models: [], error: (err as Error).message };
      }
    }),
  );
  cached = { at: Date.now(), list };
  // A failed probe is asked again next time rather than remembered.
  list.then((l) => l.some((a) => a.error) && cached?.list === list && (cached = null));
  return list;
}
