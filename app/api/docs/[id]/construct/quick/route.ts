import { aiEnabled, aiOffResponse, quickPrompt } from "@/lib/construct/agents";
import { askOnce } from "@/lib/construct/ask";
import { readDoc } from "@/lib/docs";
import { ndjsonResponse } from "@/lib/ndjson";
import { badRequest, notFound, readJson, route } from "@/lib/route";
import { titleOf } from "@/lib/text";

export const dynamic = "force-dynamic";

const clip = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");

/**
 * A look-up or grammar button's question, answered once on the quick-action
 * model, outside the chat: streams `{ t: "text", text }` pieces, then
 * `{ t: "done" }` or `{ t: "error" }`. Closing the popover stops it.
 */
export const POST = route<{ id: string }>(async (req, { id }) => {
  if (!aiEnabled()) return aiOffResponse();
  const doc = await readDoc(id);
  if (!doc) return notFound();
  const body = (await readJson(req)) as { text?: unknown; context?: Record<string, unknown> } | undefined;
  const text = clip(body?.text, 4000);
  if (!text) return badRequest("empty question");
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
});
