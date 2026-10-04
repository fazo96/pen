import { sanitizePatch } from "@/lib/grammarConfig";
import { getGrammar, patchGrammar } from "@/lib/grammarStore";
import { badRequest, readJson, route } from "@/lib/route";

export const dynamic = "force-dynamic";

/** The grammar checker's dictionary, dialect and rule switches. */
export const GET = route(async () => Response.json(await getGrammar()));

/** Apply one change (see GrammarPatch). Returns the config as saved. */
export const PATCH = route(async (req) => {
  const patch = sanitizePatch(await readJson(req));
  if (!patch) return badRequest("invalid change");
  return Response.json(await patchGrammar(patch));
});
