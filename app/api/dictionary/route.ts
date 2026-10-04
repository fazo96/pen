import { lookUp } from "@/lib/dictionary";
import { badRequest, fail, route } from "@/lib/route";

export const dynamic = "force-dynamic";

/**
 * Meanings and synonyms of `?word=` (a word or short phrase). The first look-up
 * waits while the dictionary is downloaded; 503 if that fails.
 */
export const GET = route(async (req) => {
  const word = new URL(req.url).searchParams.get("word")?.trim() ?? "";
  if (!word || word.length > 64 || !/\p{L}/u.test(word)) return badRequest("no word");
  try {
    return Response.json({ word, entries: await lookUp(word) });
  } catch (err) {
    return fail(503, (err as Error).message);
  }
});
