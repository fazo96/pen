import { importVersion, listVersions, MAX_BYTES, readDoc, saveVersion } from "@/lib/docs";
import { badRequest, fail, notFound, noStore, readJson, route } from "@/lib/route";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  if (!(await readDoc(id))) return notFound();
  return noStore(await listVersions(id));
});

/**
 * Save a named version of the manuscript as it is on disk, or, with
 * `content`, import an older draft from elsewhere, dated `created`.
 */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const body = ((await readJson(req)) ?? {}) as { label?: unknown; content?: unknown; created?: unknown };
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) : "";

  if (body.content === undefined) {
    const meta = await saveVersion(id, label);
    return meta ? Response.json(meta, { status: 201 }) : notFound();
  }

  if (typeof body.content !== "string") return badRequest("content must be a string");
  if (Buffer.byteLength(body.content) > MAX_BYTES) return fail(413, "file too large (max 5 MB)");
  // A file's own date places it in the timeline; nothing from the future.
  const now = Date.now();
  const created = typeof body.created === "number" && body.created > 0 && body.created < now ? body.created : now;
  const meta = await importVersion(id, body.content, label, Math.floor(created));
  return meta ? Response.json(meta, { status: 201 }) : notFound();
});
