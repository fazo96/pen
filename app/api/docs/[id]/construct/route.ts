import { aiEnabled, aiOffResponse, isAgentId } from "@/lib/construct/agents";
import { getSession } from "@/lib/construct/session";
import { promptContextFrom } from "@/lib/construct/prompts";
import type { ConstructAction, ConstructEvent } from "@/lib/construct/types";
import { isValidId, readDoc } from "@/lib/docs";
import { badRequest, fail, noContent, notFound, readJson, route } from "@/lib/route";

export const dynamic = "force-dynamic";

/** Where the agent process reaches pen's MCP endpoint: this server, on loopback. */
function internalUrl(req: Request) {
  if (process.env.PEN_INTERNAL_URL) return process.env.PEN_INTERNAL_URL.replace(/\/$/, "");
  const port = new URL(req.url).port || process.env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}

/** Server-sent events: a snapshot of the conversation, then every change. */
export const GET = route<{ id: string }>(async (req, { id }) => {
  if (!aiEnabled()) return aiOffResponse();
  if (!(await readDoc(id))) return notFound();
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
});


/** Drive the conversation. Replies come back over the event stream. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  if (!aiEnabled()) return aiOffResponse();
  if (!(await readDoc(id))) return notFound();
  const body = (await readJson(req)) as ConstructAction | undefined;
  if (!body || typeof body !== "object") return badRequest("invalid json");
  const session = await getSession(id, internalUrl(req));

  try {
    switch (body.action) {
      case "start":
        await session.start();
        break;
      case "switch":
        if (!isAgentId(body.agent)) return badRequest("unknown agent");
        if (body.model !== undefined && typeof body.model !== "string") return badRequest("invalid model");
        await session.switchAgent(body.agent, body.model);
        break;
      case "prompt": {
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return badRequest("empty prompt");
        if (session.busy) return fail(409, "Construct is still answering.");
        const context = promptContextFrom(body.context);
        // Runs to the end of the turn in the background; the stream shows progress.
        void session.prompt(text.slice(0, 20_000), context);
        break;
      }
      case "compact":
        if (session.busy) return fail(409, "Construct is still answering.");
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
        if (typeof body.chatId !== "string" || !isValidId(body.chatId)) return badRequest("chatId required");
        await (body.action === "open-chat" ? session.openChat(body.chatId) : session.deleteChat(body.chatId));
        break;
      case "rename-chat":
        if (typeof body.chatId !== "string" || !isValidId(body.chatId)) return badRequest("chatId required");
        if (typeof body.title !== "string") return badRequest("title required");
        await session.renameChat(body.chatId, body.title);
        break;
      case "config":
        if (typeof body.configId !== "string" || typeof body.value !== "string") return badRequest("configId and value required");
        await session.setConfig(body.configId, body.value);
        break;
      default:
        return badRequest("unknown action");
    }
  } catch (err) {
    return fail(409, (err as Error).message);
  }
  return noContent();
});
