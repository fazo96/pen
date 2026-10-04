import { coverExtOf, MAX_COVER_BYTES, readCover, removeCover, writeCover } from "@/lib/docs";
import { fail, noContent, notFound, route } from "@/lib/route";

export const dynamic = "force-dynamic";

/** The cover image. Links carry ?v=<mtime>, so a response never goes stale. */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const cover = await readCover(id);
  if (!cover) return notFound();
  return new Response(new Uint8Array(cover.data), {
    headers: {
      "Content-Type": cover.type,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

const tooLarge = () => fail(413, "image too large (max 10 MB)");

/** Set the cover: the raw image bytes as the body. */
export const PUT = route<{ id: string }>(async (req, { id }) => {
  if (Number(req.headers.get("content-length")) > MAX_COVER_BYTES) return tooLarge();
  const data = new Uint8Array(await req.arrayBuffer());
  if (data.byteLength > MAX_COVER_BYTES) return tooLarge();
  const ext = coverExtOf(data);
  if (!ext) return fail(415, "cover must be a JPEG, PNG, WebP, AVIF or GIF image");
  return (await writeCover(id, data, ext)) ? noContent() : notFound();
});

export const DELETE = route<{ id: string }>(async (_req, { id }) => ((await removeCover(id)) ? noContent() : notFound()));
