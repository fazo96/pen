import "server-only";
import { MAX_BYTES } from "./docs";

export type SaveBody = { content: string; baseVersion: string | null; force: boolean };

/** Parse an autosave request (PUT, or POST from sendBeacon); a Response on bad input. */
export async function readSaveBody(req: Request): Promise<SaveBody | Response> {
  let body: { content?: unknown; baseVersion?: unknown; force?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return Response.json({ error: "content must be a string" }, { status: 400 });
  }
  if (Buffer.byteLength(body.content) > MAX_BYTES) {
    return Response.json({ error: "document too large (max 5 MB)" }, { status: 413 });
  }
  return {
    content: body.content,
    baseVersion: typeof body.baseVersion === "string" ? body.baseVersion : null,
    force: body.force === true,
  };
}
