import { isValidId, writeSpot } from "@/lib/docs";
import { badRequest, noContent, notFound, readJson, route } from "@/lib/route";
import { sanitizeSpot } from "@/lib/spot";

export const dynamic = "force-dynamic";

/**
 * Remember where the writer is (lib/spot.ts): `{ spot }` in the manuscript,
 * `{ entry, spot }` in a Codex entry, `{ entry }` when one is opened. A lone
 * Spot (pages loaded before entries had spots) is the manuscript's.
 */
const save = route<{ id: string }>(async (req, { id }) => {
  const body = ((await readJson(req)) ?? null) as { entry?: unknown; spot?: unknown } | null;
  const legacy = sanitizeSpot(body);
  const spot = legacy ?? sanitizeSpot(body?.spot);
  const entry = legacy ? null : body?.entry;
  if (entry != null && !isValidId(entry)) return notFound();
  if (!spot && entry == null) return badRequest("bad spot");
  return (await writeSpot(id, entry ?? null, spot)) ? noContent() : notFound();
});

export const PUT = save;
// navigator.sendBeacon can only POST; used when the page is hidden or closed.
export const POST = save;
