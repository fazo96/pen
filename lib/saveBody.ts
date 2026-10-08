import "server-only";
import { MAX_BYTES } from "./docs";
import type { Pastes } from "./writingStats";

export type SaveBody = { content: string; baseVersion: string | null; force: boolean; pasted: number; moved: number };

const words = (x: unknown) => (typeof x === "number" && x > 0 ? x : 0);

/** Parse an autosave request (PUT, or POST from sendBeacon); a Response on bad input. */
export async function readSaveBody(req: Request): Promise<SaveBody | Response> {
  let body: { content?: unknown; baseVersion?: unknown; force?: unknown; pasted?: unknown; moved?: unknown };
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
    // Words pasted since the last save, and words cut in pen and pasted back, for the writing stats.
    pasted: words(body.pasted),
    moved: words(body.moved),
  };
}

/**
 * The writing stats' part of a save: its pasted and moved words. A forced save
 * ("keep mine" after a conflict) isn't counted: it's measured against the other
 * device's text, so its numbers would mean nothing.
 */
export const trackOf = (body: SaveBody): Pastes | undefined => (body.force ? undefined : { pasted: body.pasted, moved: body.moved });
