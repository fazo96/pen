import { createDoc, listDocs, MAX_BYTES } from "@/lib/docs";
import { hasSession, lockedResponse } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await hasSession())) return lockedResponse();
  return Response.json(await listDocs(), { headers: { "Cache-Control": "no-store" } });
}

/** Create a document: blank ("New") or with content (import). */
export async function POST(req: Request) {
  if (!(await hasSession())) return lockedResponse();
  let body: { content?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const content = body.content ?? "";
  if (typeof content !== "string") {
    return Response.json({ error: "content must be a string" }, { status: 400 });
  }
  if (Buffer.byteLength(content) > MAX_BYTES) {
    return Response.json({ error: "file too large (max 5 MB)" }, { status: 413 });
  }
  const name = typeof body.name === "string" ? body.name : undefined;
  const doc = await createDoc(content, name);
  return Response.json(doc, { status: 201 });
}
