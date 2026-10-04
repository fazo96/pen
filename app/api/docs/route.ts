import { createDoc, listDocs, MAX_BYTES } from "@/lib/docs";
import { badRequest, fail, noStore, readJson, route } from "@/lib/route";

export const dynamic = "force-dynamic";

export const GET = route(async () => noStore(await listDocs()));

/** Create a document: blank ("New") or with content (import). */
export const POST = route(async (req) => {
  const body = (await readJson(req)) as { content?: unknown; name?: unknown } | undefined;
  if (!body) return badRequest("invalid json");
  const content = body.content ?? "";
  if (typeof content !== "string") return badRequest("content must be a string");
  if (Buffer.byteLength(content) > MAX_BYTES) return fail(413, "file too large (max 5 MB)");
  const name = typeof body.name === "string" ? body.name : undefined;
  return Response.json(await createDoc(content, name), { status: 201 });
});
