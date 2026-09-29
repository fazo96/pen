import { isValidId, readEntry, trashEntry, writeEntry } from "@/lib/docs";
import { readSaveBody } from "@/lib/saveBody";
import { hasSession, lockedResponse } from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; eid: string }> };

const notFound = () => Response.json({ error: "not found" }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id, eid } = await params;
  const entry = await readEntry(id, eid);
  return entry ? Response.json(entry, { headers: { "Cache-Control": "no-store" } }) : notFound();
}

async function save(req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id, eid } = await params;
  if (!isValidId(id) || !isValidId(eid)) return notFound();
  const body = await readSaveBody(req);
  if (body instanceof Response) return body;
  const result = await writeEntry(id, eid, body.content, body.baseVersion, body.force);
  if (!result.ok) return Response.json(result.current, { status: 409 });
  return Response.json({ version: result.version });
}

export const PUT = save;
export const POST = save; // sendBeacon

export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id, eid } = await params;
  if (!isValidId(id) || !isValidId(eid)) return notFound();
  return (await trashEntry(id, eid)) ? new Response(null, { status: 204 }) : notFound();
}
