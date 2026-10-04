import { importPage } from "@/lib/imports";
import { hasSession, lockedResponse } from "@/lib/session";

export const dynamic = "force-dynamic";

/** An import's nth photo (from 0), for its page. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; job: string; n: string }> }) {
  if (!(await hasSession())) return lockedResponse();
  const { id, job, n } = await params;
  const page = /^\d+$/.test(n) ? importPage(id, job, Number(n)) : null;
  if (!page) return Response.json({ error: "not found" }, { status: 404 });
  return new Response(new Uint8Array(page.data), {
    headers: { "Content-Type": page.mimeType, "Cache-Control": "private, max-age=3600" },
  });
}
