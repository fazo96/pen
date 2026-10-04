import { badRequest, readJson, route } from "@/lib/route";
import { sanitize } from "@/lib/shelfLayout";
import { saveShelves } from "@/lib/shelves";

export const dynamic = "force-dynamic";

/** Replace the arrangement of books on shelves. Returns it as saved. */
export const PUT = route(async (req) => {
  const layout = sanitize(await readJson(req));
  if (!layout) return badRequest("invalid shelves");
  return Response.json(await saveShelves(layout));
});
