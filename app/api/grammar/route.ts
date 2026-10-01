import { sanitizePatch } from "@/lib/grammarConfig";
import { getGrammar, patchGrammar } from "@/lib/grammarStore";
import { hasSession, lockedResponse } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The grammar checker's dictionary, dialect and rule switches. */
export async function GET() {
  if (!(await hasSession())) return lockedResponse();
  return Response.json(await getGrammar());
}

/** Apply one change (see GrammarPatch). Returns the config as saved. */
export async function PATCH(req: Request) {
  if (!(await hasSession())) return lockedResponse();
  let patch;
  try {
    patch = sanitizePatch(await req.json());
  } catch {
    patch = null;
  }
  if (!patch) return Response.json({ error: "invalid change" }, { status: 400 });
  return Response.json(await patchGrammar(patch));
}
