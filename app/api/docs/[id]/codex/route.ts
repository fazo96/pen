import { createEntry, listCodex, MAX_BYTES } from "@/lib/docs";
import { hasSession, lockedResponse } from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ error: "not found" }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const list = await listCodex((await params).id);
  return list ? Response.json(list, { headers: { "Cache-Control": "no-store" } }) : notFound();
}

export async function POST(req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const body = (await req.json().catch(() => ({}))) as { content?: unknown; name?: unknown };
  const content = typeof body.content === "string" ? body.content : "";
  if (Buffer.byteLength(content) > MAX_BYTES) {
    return Response.json({ error: "entry too large (max 5 MB)" }, { status: 413 });
  }
  const entry = await createEntry((await params).id, content, typeof body.name === "string" ? body.name : undefined);
  return entry ? Response.json(entry, { status: 201 }) : notFound();
}
