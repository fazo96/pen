import { isValidId, MAX_BYTES, readDoc, trashDoc, writeDoc } from "@/lib/docs";
import { hasSession, lockedResponse } from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ error: "not found" }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const doc = await readDoc((await params).id);
  if (!doc) return notFound();
  return Response.json(doc, { headers: { "Cache-Control": "no-store" } });
}

async function save(req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id } = await params;
  if (!isValidId(id)) return notFound();
  let body: { content?: unknown; baseVersion?: unknown; force?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return Response.json({ error: "content must be a string" }, { status: 400 });
  }
  if (Buffer.byteLength(body.content) > MAX_BYTES) {
    return Response.json({ error: "document too large (max 5 MB)" }, { status: 413 });
  }
  const base = typeof body.baseVersion === "string" ? body.baseVersion : null;
  const result = await writeDoc(id, body.content, base, body.force === true);
  if (!result.ok) return Response.json(result.current, { status: 409 });
  return Response.json({ version: result.version });
}

export const PUT = save;
// navigator.sendBeacon can only POST; used for the last-chance save on pagehide.
export const POST = save;

export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id } = await params;
  if (!isValidId(id)) return notFound();
  return (await trashDoc(id)) ? new Response(null, { status: 204 }) : notFound();
}
