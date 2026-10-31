import "server-only";
import { GLOBAL } from "../../ids";
import { codexTools, moveTool } from "./codex";
import { type Tool, type ToolContext, ToolError } from "./core";
import { editTools } from "./edit";
import { manuscriptTools } from "./manuscript";
import { versionTools } from "./versions";

// Everything Construct can do, and nothing more. The agent's own file, shell
// and web tools are switched off; these are served to it over MCP (see
// ../mcp.ts). The versions are read-only by construction: no tool here writes
// them. The manuscript is changed only by edit.ts's tools, and only as far as
// the writer's Manuscript setting allows (Off by default). One file per area;
// each tool's schema is also what its arguments are checked against (core.ts).
// The reading tools also read the writer's other books (`book`), never write
// them. The Global Codex has no manuscript: its chats get its Codex tools, and
// read the books by naming one; grammar_check, the editing tools and
// move_codex_entry are a book's.

export type { CodexChange, ToolContext } from "./core";

const TOOLS: Tool[] = [...manuscriptTools, ...editTools, ...versionTools, ...codexTools, moveTool];
const GLOBAL_TOOLS: Tool[] = TOOLS.filter((t) => t !== moveTool && t.name !== "grammar_check" && !editTools.includes(t));

/** The tools a chat of `projectId` gets. */
function toolsFor(projectId: string): Tool[] {
  return projectId === GLOBAL ? GLOBAL_TOOLS : TOOLS;
}

const GLOBAL_BOOK = "A book's id from list_books: needed to read a manuscript or its versions; for the Codex tools, omit it for the Global Codex.";

/** As the agent sees them; in the Global Codex, without the `global` flag, which is moot there, and with `book` reworded. */
export function listTools(projectId: string) {
  return toolsFor(projectId).map(({ name, description, inputSchema, readOnly }) => {
    let schema = inputSchema;
    if (projectId === GLOBAL) {
      const { global: _, ...properties } = inputSchema.properties;
      if (properties.book) properties.book = { ...properties.book, description: GLOBAL_BOOK };
      schema = { ...inputSchema, properties };
    }
    return {
      name,
      description,
      inputSchema: schema,
      annotations: { readOnlyHint: readOnly, destructiveHint: name === "delete_codex_entry" },
    };
  });
}

export type ToolResult = { text: string; isError: boolean };

export async function callTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = toolsFor(ctx.projectId).find((t) => t.name === name);
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
