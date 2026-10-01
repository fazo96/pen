import { lookUp } from "@/lib/dictionary";
import { hasSession, lockedResponse } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Meanings and synonyms of `?word=` (a word or short phrase). The first look-up
 * waits while the dictionary is downloaded; 503 if that fails.
 */
export async function GET(req: Request) {
  if (!(await hasSession())) return lockedResponse();
  const word = new URL(req.url).searchParams.get("word")?.trim() ?? "";
  if (!word || word.length > 64 || !/\p{L}/u.test(word)) return Response.json({ error: "no word" }, { status: 400 });
  try {
    return Response.json({ word, entries: await lookUp(word) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
}
