import { coverExtOf, isValidId, MAX_COVER_BYTES, readCover, removeCover, writeCover } from "@/lib/docs";
import { hasSession, lockedResponse } from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ error: "not found" }, { status: 404 });

/** The cover image. Links carry ?v=<mtime>, so a response never goes stale. */
export async function GET(_req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const cover = await readCover((await params).id);
  if (!cover) return notFound();
  return new Response(new Uint8Array(cover.data), {
    headers: {
      "Content-Type": cover.type,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Set the cover: the raw image bytes as the body. */
export async function PUT(req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id } = await params;
  if (!isValidId(id)) return notFound();
  if (Number(req.headers.get("content-length")) > MAX_COVER_BYTES) {
    return Response.json({ error: "image too large (max 10 MB)" }, { status: 413 });
  }
  const data = new Uint8Array(await req.arrayBuffer());
  if (data.byteLength > MAX_COVER_BYTES) {
    return Response.json({ error: "image too large (max 10 MB)" }, { status: 413 });
  }
  const ext = coverExtOf(data);
  if (!ext) {
    return Response.json({ error: "cover must be a JPEG, PNG, WebP, AVIF or GIF image" }, { status: 415 });
  }
  return (await writeCover(id, data, ext)) ? new Response(null, { status: 204 }) : notFound();
}

export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id } = await params;
  if (!isValidId(id)) return notFound();
  return (await removeCover(id)) ? new Response(null, { status: 204 }) : notFound();
}
