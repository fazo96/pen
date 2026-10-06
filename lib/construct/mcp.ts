import "server-only";
import { callTool, listTools, type ToolContext } from "./tools";

// Just enough of MCP's Streamable HTTP transport to serve Construct's tools:
// JSON-RPC over POST with plain JSON replies, no server-initiated stream.

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const ok = (id: RpcMessage["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: RpcMessage["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(msg: RpcMessage, ctx: ToolContext) {
  const { id, method, params = {} } = msg;
  switch (method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "pen", version: "1.0.0" },
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: listTools(ctx.projectId) });
    case "tools/call": {
      if (typeof params.name !== "string") return fail(id, -32602, "missing tool name");
      const { text, isError } = await callTool(params.name, params.arguments, ctx);
      return ok(id, { content: [{ type: "text", text }], isError });
    }
    case "resources/list":
      return ok(id, { resources: [] });
    case "prompts/list":
      return ok(id, { prompts: [] });
    default:
      return fail(id, -32601, `method not found: ${method}`);
  }
}

/** Handle one POST body; null means "notifications only, reply 202". */
export async function handleMcp(body: unknown, ctx: ToolContext): Promise<unknown> {
  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as RpcMessage[];
  const replies = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object" || typeof msg.method !== "string") {
      // A response to something we never sent, or garbage.
      if (msg && typeof msg === "object" && "id" in msg && !("result" in msg || "error" in msg)) {
        replies.push(fail(msg.id, -32600, "invalid request"));
      }
      continue;
    }
    if (msg.id === undefined || msg.id === null) continue; // notification
    replies.push(await handle(msg, ctx));
  }
  if (!replies.length) return null;
  return batch ? replies : replies[0];
}
