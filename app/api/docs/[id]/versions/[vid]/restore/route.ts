import { restoreVersion } from "@/lib/docs";
import { notFound, route } from "@/lib/route";

export const dynamic = "force-dynamic";

/** Make a version the manuscript again; the replaced text becomes a version. */
export const POST = route<{ id: string; vid: string }>(async (_req, { id, vid }) => {
  const doc = await restoreVersion(id, vid);
  return doc ? Response.json(doc) : notFound();
});
