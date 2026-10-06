import { isOwnerId, moveEntry } from "@/lib/docs";
import { badRequest, notFound, readJson, route } from "@/lib/route";

export const dynamic = "force-dynamic";

/**
 * Move an entry to another Codex: `{ to }` is a book's id or "_global" (the
 * Global Codex). Answers `{ id }`, its id there (-2 and so on if taken).
 */
export const POST = route<{ id: string; eid: string }>(
  async (req, { id, eid }) => {
    const body = (await readJson(req)) as { to?: unknown } | undefined;
    const to = body?.to;
    if (!isOwnerId(to)) return badRequest("to must be a book's id or _global");
    if (to === id) return badRequest("the entry is already there");
    const moved = await moveEntry(id, eid, to);
    return moved ? Response.json({ id: moved }) : notFound();
  },
  { global: true },
);
