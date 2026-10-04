import { isAgentId } from "@/lib/construct/agents";
import { getSession } from "@/lib/construct/session";
import type { ConstructEvent, PromptContext } from "@/lib/construct/types";
import { isValidId, readDoc } from "@/lib/docs";
import { hasSession, lockedResponse } from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ error: "not found" }, { status: 404 });
const bad = (error: string) => Response.json({ error }, { status: 400 });

/** Where the agent process reaches pen's MCP endpoint: this server, on loopback. */
function internalUrl(req: Request) {
  if (process.env.PEN_INTERNAL_URL) return process.env.PEN_INTERNAL_URL.replace(/\/$/, "");
  const port = new URL(req.url).port || process.env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}

async function project(params: Ctx["params"]) {
  const { id } = await params;
  return isValidId(id) && (await readDoc(id)) ? id : null;
}

/** Server-sent events: a snapshot of the conversation, then every change. */
export async function GET(req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const id = await project(params);
  if (!id) return notFound();
  const session = await getSession(id, internalUrl(req));

  const enc = new TextEncoder();
  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: ConstructEvent) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      const unsubscribe = session.subscribe(send);
      const ping = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 25_000);
      cleanup = () => {
        unsubscribe();
        clearInterval(ping);
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel: () => cleanup(),
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

type Action =
  | { action: "start" }
  | { action: "switch"; agent: string; model?: string }
  | { action: "prompt"; text: string; context?: PromptContext }
  | { action: "compact" }
  | { action: "cancel" }
  | { action: "reset" }
  | { action: "open-chat"; chatId: string }
  | { action: "delete-chat"; chatId: string }
  | { action: "rename-chat"; chatId: string; title: string }
  | { action: "config"; configId: string; value: string };

/** Drive the conversation. Replies come back over the event stream. */
export async function POST(req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const id = await project(params);
  if (!id) return notFound();
  const body = (await req.json().catch(() => null)) as Action | null;
  if (!body || typeof body !== "object") return bad("invalid json");
  const session = await getSession(id, internalUrl(req));

  try {
    switch (body.action) {
      case "start":
        await session.start();
        break;
      case "switch":
        if (!isAgentId(body.agent)) return bad("unknown agent");
        if (body.model !== undefined && typeof body.model !== "string") return bad("invalid model");
        await session.switchAgent(body.agent, body.model);
        break;
      case "prompt": {
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return bad("empty prompt");
        if (session.busy) return Response.json({ error: "Construct is still answering." }, { status: 409 });
        const c = body.context ?? {};
        const context: PromptContext = {
          ...(typeof c.entry === "string" && isValidId(c.entry) ? { entry: c.entry } : {}),
          ...(typeof c.selection === "string" && c.selection.trim() ? { selection: c.selection.slice(0, 4000) } : {}),
          ...(typeof c.paragraph === "string" && c.paragraph.trim() ? { paragraph: c.paragraph.slice(0, 8000) } : {}),
        };
        // Runs to the end of the turn in the background; the stream shows progress.
        void session.prompt(text.slice(0, 20_000), context);
        break;
      }
      case "compact":
        if (session.busy) return Response.json({ error: "Construct is still answering." }, { status: 409 });
        void session.compact();
        break;
      case "cancel":
        await session.cancel();
        break;
      case "reset":
        await session.reset();
        break;
      case "open-chat":
      case "delete-chat":
        if (typeof body.chatId !== "string" || !isValidId(body.chatId)) return bad("chatId required");
        await (body.action === "open-chat" ? session.openChat(body.chatId) : session.deleteChat(body.chatId));
        break;
      case "rename-chat":
        if (typeof body.chatId !== "string" || !isValidId(body.chatId)) return bad("chatId required");
        if (typeof body.title !== "string") return bad("title required");
        await session.renameChat(body.chatId, body.title);
        break;
      case "config":
        if (typeof body.configId !== "string" || typeof body.value !== "string") return bad("configId and value required");
        await session.setConfig(body.configId, body.value);
        break;
      default:
        return bad("unknown action");
    }
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 409 });
  }
  return new Response(null, { status: 204 });
}
