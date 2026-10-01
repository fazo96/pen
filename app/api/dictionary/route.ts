import { lookUp } from "@/lib/dictionary";
import { hasSession, lockedResponse } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Meanings and synonyms of `?word=` (a word or short phrase). 503 if the dictionary isn't installed. */
export async function GET(req: Request) {
  if (!(await hasSession())) return lockedResponse();
  const word = new URL(req.url).searchParams.get("word")?.trim() ?? "";
  if (!word || word.length > 64 || !/\p{L}/u.test(word)) return Response.json({ error: "no word" }, { status: 400 });
  const entries = await lookUp(word);
  if (!entries) return Response.json({ error: "The dictionary isn’t installed. Run npm run dictionary." }, { status: 503 });
  return Response.json({ word, entries });
}
