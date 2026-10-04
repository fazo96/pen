import { dropSession } from "@/lib/construct/session";
import { isValidId, readDoc, renameDoc, trashDoc, writeDoc } from "@/lib/docs";
import { badRequest, fail, noContent, notFound, noStore, readJson, route } from "@/lib/route";
import { readSaveBody } from "@/lib/saveBody";
import { renameOnShelves } from "@/lib/shelves";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  const doc = await readDoc(id);
  return doc ? noStore(doc) : notFound();
});

const save = route<{ id: string }>(async (req, { id }) => {
  const body = await readSaveBody(req);
  if (body instanceof Response) return body;
  const result = await writeDoc(id, body.content, body.baseVersion, body.force);
  if (!result.ok) return Response.json(result.current, { status: 409 });
  return Response.json({ version: result.version });
});

export const PUT = save;
// navigator.sendBeacon can only POST; used for the last-chance save on pagehide.
export const POST = save;

export const DELETE = route<{ id: string }>(async (_req, { id }) => ((await trashDoc(id)) ? noContent() : notFound()));

/** Change the project's id (and URLs): `{ id: "new-id" }`. */
export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const to = ((await readJson(req)) as { id?: unknown } | undefined)?.id;
  if (!isValidId(to)) {
    return badRequest("Use lowercase letters, digits and hyphens (up to 80), starting with a letter or digit.");
  }
  const result = await renameDoc(id, to);
  if (result === "missing" || result === "invalid") return notFound();
  if (result === "taken") return fail(409, `Another book already uses “${to}”.`);
  if (to !== id) {
    dropSession(id); // its agent works under the old id
    await renameOnShelves(id, to);
  }
  return Response.json({ id: to });
});
