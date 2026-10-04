import { aiEnabled, aiOffResponse } from "@/lib/construct/agents";
import { listModels } from "@/lib/construct/ask";
import { noStore, route } from "@/lib/route";

export const dynamic = "force-dynamic";

/** The agents Construct can run on here, each with its models (`?fresh` asks them again). */
export const GET = route(async (req) => {
  if (!aiEnabled()) return aiOffResponse();
  const fresh = new URL(req.url).searchParams.has("fresh");
  return noStore(await listModels(fresh));
});
