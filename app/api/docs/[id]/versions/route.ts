import { importVersion, isValidId, listVersions, MAX_BYTES, readDoc, saveVersion } from "@/lib/docs";
import { hasSession, lockedResponse } from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ error: "not found" }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id } = await params;
  if (!isValidId(id) || !(await readDoc(id))) return notFound();
  return Response.json(await listVersions(id), { headers: { "Cache-Control": "no-store" } });
}

/**
 * Save a named version of the manuscript as it is on disk, or, with
 * `content`, import an older draft from elsewhere, dated `created`.
 */
export async function POST(req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id } = await params;
  if (!isValidId(id)) return notFound();
  const body = (await req.json().catch(() => ({}))) as { label?: unknown; content?: unknown; created?: unknown };
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) : "";

  if (body.content === undefined) {
    const meta = await saveVersion(id, label);
    return meta ? Response.json(meta, { status: 201 }) : notFound();
  }

  if (typeof body.content !== "string") {
    return Response.json({ error: "content must be a string" }, { status: 400 });
  }
  if (Buffer.byteLength(body.content) > MAX_BYTES) {
    return Response.json({ error: "file too large (max 5 MB)" }, { status: 413 });
  }
  // A file's own date places it in the timeline; nothing from the future.
  const now = Date.now();
  const created = typeof body.created === "number" && body.created > 0 && body.created < now ? body.created : now;
  const meta = await importVersion(id, body.content, label, Math.floor(created));
  return meta ? Response.json(meta, { status: 201 }) : notFound();
}
