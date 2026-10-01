import { isValidId, writeSpot } from "@/lib/docs";
import { hasSession, lockedResponse } from "@/lib/session";
import { sanitizeSpot } from "@/lib/spot";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ error: "not found" }, { status: 404 });

/** Remember where the writer is in the manuscript (lib/spot.ts). */
async function save(req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id } = await params;
  if (!isValidId(id)) return notFound();
  let spot = null;
  try {
    spot = sanitizeSpot(JSON.parse(await req.text()));
  } catch {}
  if (!spot) return Response.json({ error: "bad spot" }, { status: 400 });
  return (await writeSpot(id, spot)) ? new Response(null, { status: 204 }) : notFound();
}

export const PUT = save;
// navigator.sendBeacon can only POST; used when the page is hidden or closed.
export const POST = save;
