import "server-only";
import { MAX_BYTES } from "./docs";

export type SaveBody = { content: string; baseVersion: string | null; force: boolean; pasted: number };

/** Parse an autosave request (PUT, or POST from sendBeacon); a Response on bad input. */
export async function readSaveBody(req: Request): Promise<SaveBody | Response> {
  let body: { content?: unknown; baseVersion?: unknown; force?: unknown; pasted?: unknown };
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
    // Words pasted since the last save, for the writing stats.
    pasted: typeof body.pasted === "number" && body.pasted > 0 ? body.pasted : 0,
  };
}

/**
 * The writing stats' part of a save: its pasted words. A forced save ("keep
 * mine" after a conflict) isn't counted: it's measured against the other
 * device's text, so its numbers would mean nothing.
 */
export const trackOf = (body: SaveBody) => (body.force ? undefined : { pasted: body.pasted });
