import { getModelSettings, patchModelSettings } from "@/lib/construct/settings";
import { hasSession, lockedResponse } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Construct's default models: for new chats, transcribing notes and the look-up buttons. */
export async function GET() {
  if (!(await hasSession())) return lockedResponse();
  return Response.json(await getModelSettings(), { headers: { "Cache-Control": "no-store" } });
}

/** Merge in `{ chat?, transcribe?, quick? }` ("" puts one back to the default). Returns them as saved. */
export async function PATCH(req: Request) {
  if (!(await hasSession())) return lockedResponse();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return Response.json({ error: "invalid json" }, { status: 400 });
  return Response.json(await patchModelSettings(body));
}
