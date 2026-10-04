import { flagsFor } from "@/lib/grammarServer";
import { getGrammar } from "@/lib/grammarStore";
import { badRequest, fail, route } from "@/lib/route";

export const dynamic = "force-dynamic";

const MAX_TEXTS = 200;
const MAX_BYTES = 1_000_000;

/** Harper's flags for each of `{ texts }` (paragraphs), with the library's settings; unfiltered. */
export const POST = route(async (req) => {
  const body = await req.text();
  if (body.length > MAX_BYTES) return fail(413, "too much text");
  let texts: unknown;
  try {
    texts = (JSON.parse(body) as { texts?: unknown }).texts;
  } catch {}
  if (!Array.isArray(texts) || texts.length > MAX_TEXTS || !texts.every((t) => typeof t === "string")) {
    return badRequest("expected { texts: string[] }");
  }
  try {
    return Response.json({ flags: await flagsFor(texts, await getGrammar()) });
  } catch (err) {
    console.error("grammar check:", err);
    return fail(500, "The grammar checker failed.");
  }
});
