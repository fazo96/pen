import { isValidId, writeSpot } from "@/lib/docs";
import { hasSession, lockedResponse } from "@/lib/session";
import { sanitizeSpot } from "@/lib/spot";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ error: "not found" }, { status: 404 });

/**
 * Remember where the writer is (lib/spot.ts): `{ spot }` in the manuscript,
 * `{ entry, spot }` in a Codex entry, `{ entry }` when one is opened. A lone
 * Spot (pages loaded before entries had spots) is the manuscript's.
 */
async function save(req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id } = await params;
  if (!isValidId(id)) return notFound();
  let body: { entry?: unknown; spot?: unknown } | null = null;
  try {
    body = JSON.parse(await req.text());
  } catch {}
  const legacy = sanitizeSpot(body);
  const spot = legacy ?? sanitizeSpot(body?.spot);
  const entry = legacy ? null : body?.entry;
  if (entry != null && (typeof entry !== "string" || !isValidId(entry))) return notFound();
  if (!spot && entry == null) return Response.json({ error: "bad spot" }, { status: 400 });
  return (await writeSpot(id, entry ?? null, spot)) ? new Response(null, { status: 204 }) : notFound();
}

export const PUT = save;
// navigator.sendBeacon can only POST; used when the page is hidden or closed.
export const POST = save;
