import { aiEnabled, aiOffResponse, quickPrompt } from "@/lib/construct/agents";
import { askOnce } from "@/lib/construct/ask";
import { isValidId, readDoc } from "@/lib/docs";
import { ndjsonResponse } from "@/lib/ndjson";
import { hasSession, lockedResponse } from "@/lib/session";
import { titleOf } from "@/lib/text";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const clip = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");

/**
 * A look-up or grammar button's question, answered once on the quick-action
 * model, outside the chat: streams `{ t: "text", text }` pieces, then
 * `{ t: "done" }` or `{ t: "error" }`. Closing the popover stops it.
 */
export async function POST(req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  if (!aiEnabled()) return aiOffResponse();
  const { id } = await params;
  const doc = isValidId(id) ? await readDoc(id) : null;
  if (!doc) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { text?: unknown; context?: Record<string, unknown> } | null;
  const text = clip(body?.text, 4000);
  if (!text) return Response.json({ error: "empty question" }, { status: 400 });
  const selection = clip(body?.context?.selection, 4000);
  const paragraph = clip(body?.context?.paragraph, 8000);
  const lines: string[] = [];
  if (selection) lines.push(`The writer selected:\n"""\n${selection}\n"""`);
  if (paragraph && paragraph !== selection) lines.push(`It's in this paragraph:\n"""\n${paragraph}\n"""`);

  return ndjsonResponse(async (send) => {
    await askOnce("quick", {
      systemPrompt: quickPrompt(titleOf(doc.content, id)),
      prompt: [{ type: "text", text: [...lines, text].join("\n\n") }],
      onText: (t) => send({ t: "text", text: t }),
      signal: req.signal,
    });
    send({ t: "done" });
  });
}
