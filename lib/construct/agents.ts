import "server-only";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { aiSwitchedOff, claudeFound, piFound } from "./detect";

// The ACP agents Construct can run on. Each one is launched with every
// built-in tool switched off, so the only things it can touch are pen's own
// tools (./tools.ts), served to it over MCP.

/** What a launch needs to know: where it runs, how it's told who it is, and pen's tools (none for one-off runs). */
export type LaunchContext = {
  cwd: string;
  systemPrompt: string;
  mcp?: { url: string; token: string; tools: string[] };
};

export type AgentPreset = {
  name: string;
  command: string[];
  /** pen's tools reach it as ACP `mcpServers` ("acp"), or through its own config, set up in `env` ("self"). */
  mcp: "acp" | "self";
  /** Whether it can run on this server. */
  available: () => boolean;
  env?: (ctx: LaunchContext, mcpName: string) => Promise<Record<string, string>>;
  /** `_meta` for session/new: the system prompt and lockdown options. */
  sessionMeta: (ctx: LaunchContext, mcpName: string) => Record<string, unknown> | undefined;
};

const split = (cmd: string) => cmd.trim().split(/\s+/);

const PI = process.env.PEN_PI ?? "pi";
// Looked for once per process: installing an agent takes a restart.
const once = (find: () => boolean) => {
  let found: boolean | undefined;
  return () => (found ??= !aiSwitchedOff() && find());
};

export const AGENTS = {
  claude: {
    name: "Claude Code",
    command: split(process.env.PEN_CONSTRUCT_CLAUDE ?? "npx -y @agentclientprotocol/claude-agent-acp@0.84.0"),
    mcp: "acp",
    available: once(() => claudeFound()),
    sessionMeta: ({ systemPrompt }, mcpName) => ({
      systemPrompt,
      claudeCode: {
        options: {
          tools: [], // no Read/Write/Edit/Bash/Web…: pen's MCP tools only
          allowedTools: [`mcp__${mcpName}`, `mcp__${mcpName}__*`],
          strictMcpConfig: true, // ignore the user's own MCP servers
          settingSources: [], // ignore ~/.claude settings, hooks, CLAUDE.md
          allowDangerouslySkipPermissions: false,
        },
      },
    }),
  },
  // pi through pi-acp, which runs scripts/pi-construct instead of pi itself to
  // add pen's lockdown flags. pi-acp doesn't pass ACP's MCP servers on, so
  // pen's tools come from the pi-mcp-adapter extension, pointed at a config
  // file written for the session. The writer's own pi extensions still load:
  // that's where self-hosted model providers live.
  pi: {
    name: "pi",
    command: split(process.env.PEN_CONSTRUCT_PI ?? "npx -y pi-acp@0.0.34"),
    mcp: "self",
    available: once(() => piFound()),
    async env({ cwd, systemPrompt, mcp }, mcpName) {
      const env: Record<string, string> = {
        PI_ACP_PI_COMMAND: path.join(process.cwd(), "scripts", "pi-construct"),
        PEN_PI: PI,
        PEN_SYSTEM_PROMPT: systemPrompt,
        PEN_PI_TOOLS: "",
      };
      if (mcp) {
        const config = path.join(cwd, ".pen-mcp.json");
        await writeFile(
          config,
          JSON.stringify({
            // `mcp__pen_<tool>`, close to Claude Code's names; and only pen's tools, no `mcp` search proxy.
            settings: { toolPrefix: "mcp", directTools: true, disableProxyTool: true },
            mcpServers: {
              [mcpName]: { url: mcp.url, auth: "bearer", bearerTokenEnv: "PEN_MCP_TOKEN", lifecycle: "eager" },
            },
          }),
        );
        Object.assign(env, {
          PEN_PI_EXTENSION: path.join(process.cwd(), "node_modules", "pi-mcp-adapter", "index.ts"),
          PEN_PI_MCP_CONFIG: config,
          PEN_MCP_TOKEN: mcp.token,
          // The adapter's names, and pi 1.0's own MCP's (mcp__pen__<tool>) should it take over.
          PEN_PI_TOOLS: mcp.tools.flatMap((t) => [`mcp__${mcpName}_${t}`, `mcp__${mcpName}__${t}`]).join(","),
        });
      }
      return env;
    },
    sessionMeta: () => undefined,
  },
} satisfies Record<string, AgentPreset>;

export type AgentId = keyof typeof AGENTS;

export const isAgentId = (s: unknown): s is AgentId => typeof s === "string" && Object.hasOwn(AGENTS, s);

export const availableAgents = () => (Object.keys(AGENTS) as AgentId[]).filter((a) => AGENTS[a].available());

/** pen's AI features (Construct, quick questions, transcribing notes) are on only when an agent can run here. */
export const aiEnabled = () => availableAgents().length > 0;

/** For a chat or setting whose agent can't run here: the first one that can (Claude Code when none can). */
export const fallbackAgent = (): AgentId => availableAgents()[0] ?? "claude";

export const AI_OFF = "AI features are off: install Claude Code or pi on the server running pen, then restart it.";

export const aiOffResponse = () => Response.json({ error: AI_OFF }, { status: 503 });

/** A tool's name for pen (`read_manuscript`), from the agent's (`mcp__pen__read_manuscript`, `mcp__pen_read_manuscript`). */
export function penToolName(name: string, mcpName: string): string | null {
  for (const prefix of [`mcp__${mcpName}__`, `mcp__${mcpName}_`]) if (name.startsWith(prefix)) return name.slice(prefix.length);
  return null;
}

export function systemPrompt(title: string) {
  return `You are Construct, the writing companion inside pen, a quiet editor for fiction. You're working with a writer on their project "${title}".

What you can do, all through pen's tools:
- Read the manuscript (outline, read_manuscript, search). It belongs to the writer: you cannot change it, and there is no way to.
- Check spelling and grammar (grammar_check) with the same checker the writer sees underlined in the editor, using their dictionary and settings. It's mechanical: dialect, invented words and deliberate fragments get flagged too, so weigh each flag against the book's voice rather than repeating the list.
- Read the version history (list_versions, read_version, outline with a version) and compare versions with each other or with today's text (diff_versions) to see how the book has changed.
- Keep the Codex: the notes beside the manuscript (characters, places, timeline, plot threads, research, style sheets). You can create, edit, rename and delete entries. Each entry is markdown and starts with an H1 that is its title. Pen has no wiki links: refer to other entries by name, not [[Name]]. Keep entries tidy and factual; don't invent canon the writer hasn't established unless they ask you to brainstorm, and say so when you do.

The prose is the writer's own. Don't write or rewrite any of it (no suggested sentences, alternative wordings, sample lines, or "something like…" examples) unless the writer explicitly asks you to, e.g. "rewrite this", "suggest a line", "draft this scene". When you give feedback, point to the passage and say what isn't working and why, or ask a question, and leave the words to them. If an example would genuinely help, offer it in one short sentence and wait for a yes. A request covers only what it names: once you've done it, go back to not writing prose. Codex notes aren't prose; write those freely.

Manuscript conventions: "# " is the book's title, "## " a part (numbered in roman numerals), "### " a chapter (numbered straight through the book). Text between %% and %%, or inside <!-- -->, is the writer's private comments, not prose.

When you point at a passage, cite it with a markdown link the writer can tap to jump there, instead of quoting line numbers in prose: [the storm scene](pen:L120) for a line of the manuscript, [the argument](pen:L120-L134) for a range, [her first entrance](pen:v/<version id>/L40) for lines of a saved version, and [Mara](pen:codex/mara) for a Codex entry. Use the line numbers the tools gave you, and a short label that says what's there (not "line 120").

Start with outline when you need to find your way around, and read only the sections you need. Replies appear in a narrow side panel, often on a phone: be concise, use short paragraphs and lists, and skip preamble. Write in the language the writer uses.`;
}

/** For the look-up and grammar buttons: one question about the selection, answered once, outside the chat. */
export function quickPrompt(title: string) {
  return `You are Construct, the writing companion inside pen, a quiet editor for fiction, answering one quick question about a passage of the writer's book "${title}". You have no tools: the passage is in the message.

The prose is the writer's own: answer what's asked, and don't rewrite their sentences. The answer appears in a small popover over the text, often on a phone: be brief, skip preamble, and use plain markdown (short lists at most). Write in the language the writer uses.`;
}
