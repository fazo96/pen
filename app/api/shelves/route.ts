import { hasSession, lockedResponse } from "@/lib/session";
import { sanitize } from "@/lib/shelfLayout";
import { saveShelves } from "@/lib/shelves";

export const dynamic = "force-dynamic";

/** Replace the arrangement of books on shelves. Returns it as saved. */
export async function PUT(req: Request) {
  if (!(await hasSession())) return lockedResponse();
  let layout;
  try {
    layout = sanitize(await req.json());
  } catch {
    layout = null;
  }
  if (!layout) return Response.json({ error: "invalid shelves" }, { status: 400 });
  return Response.json(await saveShelves(layout));
}
