import { readEntry, trashEntry, writeEntry } from "@/lib/docs";
import { noContent, notFound, noStore, route } from "@/lib/route";
import { readSaveBody } from "@/lib/saveBody";

export const dynamic = "force-dynamic";

type Params = { id: string; eid: string };

export const GET = route<Params>(async (_req, { id, eid }) => {
  const entry = await readEntry(id, eid);
  return entry ? noStore(entry) : notFound();
});

const save = route<Params>(async (req, { id, eid }) => {
  const body = await readSaveBody(req);
  if (body instanceof Response) return body;
  const result = await writeEntry(id, eid, body.content, body.baseVersion, body.force);
  if (!result.ok) return Response.json(result.current, { status: 409 });
  return Response.json({ version: result.version });
});

export const PUT = save;
export const POST = save; // sendBeacon

export const DELETE = route<Params>(async (_req, { id, eid }) => ((await trashEntry(id, eid)) ? noContent() : notFound()));
