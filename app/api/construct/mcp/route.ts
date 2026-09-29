import { timingSafeEqual } from "node:crypto";
import { handleMcp } from "@/lib/construct/mcp";
import { sessionForToken } from "@/lib/construct/session";

// Construct's tools, called by the agent process rather than the browser, so
// the proxy lets this route through without a session cookie. Each running
// Construct session has its own bearer token, which scopes it to one project.

export const dynamic = "force-dynamic";

function authorize(req: Request) {
  const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return undefined;
  const session = sessionForToken(token);
  if (!session) return undefined;
  const a = Buffer.from(token);
  const b = Buffer.from(session.token);
  return a.length === b.length && timingSafeEqual(a, b) ? session : undefined;
}

export async function POST(req: Request) {
  const session = authorize(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400 });
  }
  const reply = await handleMcp(body, session.toolContext());
  return reply === null ? new Response(null, { status: 202 }) : Response.json(reply);
}

// No server-to-client stream and no MCP sessions to end.
export function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
