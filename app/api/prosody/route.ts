import { sanitizeProsodyPatch } from "@/lib/prosody/own";
import { getProsody, patchProsody } from "@/lib/prosodyStore";
import { badRequest, readJson, route } from "@/lib/route";

export const dynamic = "force-dynamic";

/** The writer's own pronunciations, for Cadence. */
export const GET = route(async () => Response.json(await getProsody()));

/** Set or remove one word's (see ProsodyPatch). Returns the config as saved. */
export const PATCH = route(async (req) => {
  const patch = sanitizeProsodyPatch(await readJson(req));
  if (!patch) return badRequest("invalid change");
  return Response.json(await patchProsody(patch));
});
