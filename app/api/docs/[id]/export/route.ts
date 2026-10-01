import { readDoc } from "@/lib/docs";
import { bookFiles, stamp, zipResponse } from "@/lib/library";
import { hasSession, lockedResponse } from "@/lib/session";
import { zip } from "@/lib/zip";

export const dynamic = "force-dynamic";

/** One book as a zip: its folder, and what of it is in the trash. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) return lockedResponse();
  const { id } = await params;
  if (!(await readDoc(id))) return Response.json({ error: "not found" }, { status: 404 });
  return zipResponse(zip(bookFiles(id)), `${id}-${stamp()}.zip`);
}
