import { isValidId, restoreVersion } from "@/lib/docs";
import { hasSession, lockedResponse } from "@/lib/session";
import { isValidVersionId } from "@/lib/versions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; vid: string }> };

/** Make a version the manuscript again; the replaced text becomes a version. */
export async function POST(_req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id, vid } = await params;
  if (!isValidId(id) || !isValidVersionId(vid)) return Response.json({ error: "not found" }, { status: 404 });
  const doc = await restoreVersion(id, vid);
  return doc ? Response.json(doc) : Response.json({ error: "not found" }, { status: 404 });
}
