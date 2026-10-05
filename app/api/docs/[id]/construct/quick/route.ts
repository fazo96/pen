import { aiEnabled, aiOffResponse } from "@/lib/construct/agents";
import { askOnce } from "@/lib/construct/ask";
import { AGENTS_ENTRY, promptContextFrom, quickPrompt, quickQuestion } from "@/lib/construct/prompts";
import type { QuickLine } from "@/lib/construct/types";
import { readDoc, readEntry } from "@/lib/docs";
import { ndjsonResponse } from "@/lib/ndjson";
import { badRequest, notFound, readJson, route } from "@/lib/route";
import { titleOf } from "@/lib/text";

export const dynamic = "force-dynamic";

/**
 * A look-up or grammar button's question, answered once on the quick-action
 * model, outside the chat: streams `{ t: "text", text }` pieces, then
 * `{ t: "done" }` or `{ t: "error" }`. Closing the popover stops it.
 */
export const POST = route<{ id: string }>(async (req, { id }) => {
  if (!aiEnabled()) return aiOffResponse();
  const doc = await readDoc(id);
  if (!doc) return notFound();
  const body = (await readJson(req)) as { text?: unknown; context?: unknown } | undefined;
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 4000) : "";
  if (!text) return badRequest("empty question");
  const context = promptContextFrom(body?.context);
  const agents = await readEntry(id, AGENTS_ENTRY);

  return ndjsonResponse<QuickLine>(async (send) => {
    await askOnce("quick", {
      systemPrompt: quickPrompt(titleOf(doc.content, id), agents?.content),
      prompt: [{ type: "text", text: quickQuestion(text, context) }],
      onText: (t) => send({ t: "text", text: t }),
      signal: req.signal,
    });
    send({ t: "done" });
  });
});
