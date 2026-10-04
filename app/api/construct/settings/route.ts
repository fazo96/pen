import { getModelSettings, patchModelSettings } from "@/lib/construct/settings";
import { badRequest, noStore, readJson, route } from "@/lib/route";

export const dynamic = "force-dynamic";

/** Construct's default models: for new chats, transcribing notes and the look-up buttons. */
export const GET = route(async () => noStore(await getModelSettings()));

/** Merge in `{ chat?, transcribe?, quick? }` ("" puts one back to the default). Returns them as saved. */
export const PATCH = route(async (req) => {
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json");
  return Response.json(await patchModelSettings(body as Record<string, unknown>));
});
