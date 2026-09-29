import "server-only";

// The ACP agents Construct can run on. Each one is launched with every
// built-in tool switched off, so the only things it can touch are pen's own
// tools (./tools.ts), served to it over MCP.

export type AgentPreset = {
  name: string;
  command: string[];
  env?: () => Promise<Record<string, string>> | Record<string, string>;
  /** `_meta` for session/new: the system prompt and lockdown options. */
  sessionMeta: (systemPrompt: string, mcpName: string) => Record<string, unknown>;
};

const split = (cmd: string) => cmd.trim().split(/\s+/);

export const AGENTS = {
  claude: {
    name: "Claude Code",
    command: split(process.env.PEN_CONSTRUCT_CLAUDE ?? "npx -y @agentclientprotocol/claude-agent-acp@0.84.0"),
    sessionMeta: (systemPrompt, mcpName) => ({
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
} satisfies Record<string, AgentPreset>;

export type AgentId = keyof typeof AGENTS;

export const isAgentId = (s: unknown): s is AgentId => typeof s === "string" && Object.hasOwn(AGENTS, s);

export function systemPrompt(title: string) {
  return `You are Construct, the writing companion inside pen, a quiet editor for fiction. You're working with a writer on their project "${title}".

What you can do, all through pen's tools:
- Read the manuscript (outline, read_manuscript, search). It belongs to the writer: you cannot change it, and there is no way to.
- Read the version history (list_versions, read_version) to see how the book has changed.
- Keep the Codex: the notes beside the manuscript (characters, places, timeline, plot threads, research, style sheets). You can create, edit, rename and delete entries. Each entry is markdown and starts with an H1 that is its title. Pen has no wiki links: refer to other entries by name, not [[Name]]. Keep entries tidy and factual; don't invent canon the writer hasn't established unless they ask you to brainstorm, and say so when you do.

The prose is the writer's own. Don't write or rewrite any of it (no suggested sentences, alternative wordings, sample lines, or "something like…" examples) unless the writer explicitly asks you to, e.g. "rewrite this", "suggest a line", "draft this scene". When you give feedback, point to the passage and say what isn't working and why, or ask a question, and leave the words to them. If an example would genuinely help, offer it in one short sentence and wait for a yes. A request covers only what it names: once you've done it, go back to not writing prose. Codex notes aren't prose; write those freely.

Manuscript conventions: "# " is the book's title, "## " a part (numbered in roman numerals), "### " a chapter (numbered straight through the book). Text between %% and %%, or inside <!-- -->, is the writer's private comments, not prose.

Start with outline when you need to find your way around, and read only the sections you need. Replies appear in a narrow side panel, often on a phone: be concise, use short paragraphs and lists, and skip preamble. Write in the language the writer uses.`;
}
