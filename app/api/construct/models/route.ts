import { listModels } from "@/lib/construct/ask";
import { hasSession, lockedResponse } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The agents Construct can run on here, each with its models (`?fresh` asks them again). */
export async function GET(req: Request) {
  if (!(await hasSession())) return lockedResponse();
  const fresh = new URL(req.url).searchParams.has("fresh");
  return Response.json(await listModels(fresh), { headers: { "Cache-Control": "no-store" } });
}
