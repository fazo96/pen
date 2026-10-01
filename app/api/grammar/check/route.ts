import { flagsFor } from "@/lib/grammarServer";
import { getGrammar } from "@/lib/grammarStore";
import { hasSession, lockedResponse } from "@/lib/session";

export const dynamic = "force-dynamic";

const MAX_TEXTS = 200;
const MAX_BYTES = 1_000_000;

/** Harper's flags for each of `{ texts }` (paragraphs), with the library's settings; unfiltered. */
export async function POST(req: Request) {
  if (!(await hasSession())) return lockedResponse();
  const body = await req.text();
  if (body.length > MAX_BYTES) return Response.json({ error: "too much text" }, { status: 413 });
  let texts: unknown;
  try {
    texts = (JSON.parse(body) as { texts?: unknown }).texts;
  } catch {}
  if (!Array.isArray(texts) || texts.length > MAX_TEXTS || !texts.every((t) => typeof t === "string")) {
    return Response.json({ error: "expected { texts: string[] }" }, { status: 400 });
  }
  try {
    return Response.json({ flags: await flagsFor(texts, await getGrammar()) });
  } catch (err) {
    console.error("grammar check:", err);
    return Response.json({ error: "The grammar checker failed." }, { status: 500 });
  }
}
