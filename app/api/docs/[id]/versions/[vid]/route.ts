import { deleteVersion, isValidId, readVersion, renameVersion } from "@/lib/docs";
import { hasSession, lockedResponse } from "@/lib/session";
import { isValidVersionId } from "@/lib/versions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; vid: string }> };

const notFound = () => Response.json({ error: "not found" }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id, vid } = await params;
  if (!isValidId(id) || !isValidVersionId(vid)) return notFound();
  const content = await readVersion(id, vid);
  return content === null ? notFound() : Response.json({ id: vid, content });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id, vid } = await params;
  if (!isValidId(id) || !isValidVersionId(vid)) return notFound();
  return (await deleteVersion(id, vid)) ? new Response(null, { status: 204 }) : notFound();
}

/** Rename a version (an automatic one becomes named, so it's kept). */
export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id, vid } = await params;
  if (!isValidId(id) || !isValidVersionId(vid)) return notFound();
  const body = (await req.json().catch(() => ({}))) as { label?: unknown };
  if (typeof body.label !== "string") return Response.json({ error: "label must be a string" }, { status: 400 });
  const meta = await renameVersion(id, vid, body.label.trim().slice(0, 120));
  return meta ? Response.json(meta) : notFound();
}
