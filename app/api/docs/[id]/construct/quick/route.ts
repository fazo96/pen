import { aiEnabled, aiOffResponse } from "@/lib/construct/agents";
import { askOnce } from "@/lib/construct/ask";
import { AGENTS_ENTRY, agentsText, bookAgents, promptContextFrom, quickPrompt, quickQuestion } from "@/lib/construct/prompts";
import type { QuickLine } from "@/lib/construct/types";
import { GLOBAL, readDoc, readEntry } from "@/lib/docs";
import { ndjsonResponse } from "@/lib/ndjson";
import { badRequest, notFound, readJson, route } from "@/lib/route";
import { titleOf } from "@/lib/text";

export const dynamic = "force-dynamic";

/**
 * A look-up or grammar button's question, answered once on the quick-action
 * model, outside the chat: streams `{ t: "text", text }` pieces, then
 * `{ t: "done" }` or `{ t: "error" }`. Closing the popover stops it. In the
 * Global Codex (id _global), about the writer's notes rather than a book.
 */
export const POST = route<{ id: string }>(
  async (req, { id }) => {
    if (!aiEnabled()) return aiOffResponse();
    const doc = id === GLOBAL ? null : await readDoc(id);
    if (id !== GLOBAL && !doc) return notFound();
    const body = (await readJson(req)) as { text?: unknown; context?: unknown } | undefined;
    const text = typeof body?.text === "string" ? body.text.trim().slice(0, 4000) : "";
    if (!text) return badRequest("empty question");
    const context = promptContextFrom(body?.context);
    const global = (await readEntry(GLOBAL, AGENTS_ENTRY))?.content;
    const agents = doc ? bookAgents(global, (await readEntry(id, AGENTS_ENTRY))?.content) : agentsText(global);

    return ndjsonResponse<QuickLine>(async (send) => {
      await askOnce("quick", {
        systemPrompt: quickPrompt(doc ? titleOf(doc.content, id) : null, agents),
        prompt: [{ type: "text", text: quickQuestion(text, context) }],
        onText: (t) => send({ t: "text", text: t }),
        signal: req.signal,
      });
      send({ t: "done" });
    });
  },
  { global: true },
);
