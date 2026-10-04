import "server-only";
import { codexTools } from "./codex";
import { type Tool, type ToolContext, ToolError } from "./core";
import { manuscriptTools } from "./manuscript";
import { versionTools } from "./versions";

// Everything Construct can do, and nothing more. The agent's own file, shell
// and web tools are switched off; these are served to it over MCP (see
// ../mcp.ts). The manuscript and its versions are read-only by construction:
// there is no tool here that writes them. One file per area; each tool's
// schema is also what its arguments are checked against (core.ts).

export type { CodexChange, ToolContext } from "./core";

const TOOLS: Tool[] = [...manuscriptTools, ...versionTools, ...codexTools];

export function listTools() {
  return TOOLS.map(({ name, description, inputSchema, readOnly }) => ({
    name,
    description,
    inputSchema,
    annotations: { readOnlyHint: readOnly, destructiveHint: name === "delete_codex_entry" },
  }));
}

export type ToolResult = { text: string; isError: boolean };

export async function callTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { text: `Unknown tool "${name}".`, isError: true };
  const input = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  try {
    return { text: await tool.run(input, ctx), isError: false };
  } catch (err) {
    if (err instanceof ToolError) return { text: err.message, isError: true };
    console.error(`construct tool ${name} failed`, err);
    return { text: "Something went wrong on pen's side.", isError: true };
  }
}
