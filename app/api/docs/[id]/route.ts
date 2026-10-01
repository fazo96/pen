import { dropSession } from "@/lib/construct/session";
import { isValidId, readDoc, renameDoc, trashDoc, writeDoc } from "@/lib/docs";
import { readSaveBody } from "@/lib/saveBody";
import { hasSession, lockedResponse } from "@/lib/session";
import { renameOnShelves } from "@/lib/shelves";

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
  const body = await readSaveBody(req);
  if (body instanceof Response) return body;
  const result = await writeDoc(id, body.content, body.baseVersion, body.force);
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

/** Change the project's id (and URLs): `{ id: "new-id" }`. */
export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id } = await params;
  let to: unknown;
  try {
    to = ((await req.json()) as { id?: unknown }).id;
  } catch {}
  if (typeof to !== "string" || !isValidId(to)) {
    return Response.json(
      { error: "Use lowercase letters, digits and hyphens (up to 80), starting with a letter or digit." },
      { status: 400 },
    );
  }
  const result = await renameDoc(id, to);
  if (result === "missing" || result === "invalid") return notFound();
  if (result === "taken") return Response.json({ error: `Another book already uses “${to}”.` }, { status: 409 });
  if (to !== id) {
    dropSession(id); // its agent works under the old id
    await renameOnShelves(id, to);
  }
  return Response.json({ id: to });
}
