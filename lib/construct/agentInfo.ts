// What the browser knows about Construct's agents: their ids and names. The
// rest (how to start them, whether they're installed) is server-side, in
// ./agents.ts, which takes the names from here. Pure, so tests load it too.

export const AGENT_NAMES = { claude: "Claude Code", pi: "pi" } as const;

export type AgentId = keyof typeof AGENT_NAMES;

export const isAgentId = (s: unknown): s is AgentId => typeof s === "string" && Object.hasOwn(AGENT_NAMES, s);

/** Unset model settings mean this agent's own default. */
export const DEFAULT_AGENT: AgentId = "claude";

export const agentName = (id: string) => (AGENT_NAMES as Record<string, string>)[id] ?? id;
