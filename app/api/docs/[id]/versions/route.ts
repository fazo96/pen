import { isValidId, listVersions, readDoc, saveVersion } from "@/lib/docs";
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

/** Save a named version of the manuscript as it is on disk. */
export async function POST(req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id } = await params;
  if (!isValidId(id)) return notFound();
  const body = (await req.json().catch(() => ({}))) as { label?: unknown };
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) : "";
  const meta = await saveVersion(id, label);
  return meta ? Response.json(meta, { status: 201 }) : notFound();
}
