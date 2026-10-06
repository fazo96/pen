import { importPage } from "@/lib/imports";
import { notFound, route } from "@/lib/route";

export const dynamic = "force-dynamic";

/** An import's nth photo (from 0), for its page. */
export const GET = route<{ id: string; job: string; n: string }>(async (_req, { id, job, n }) => {
  const page = /^\d+$/.test(n) ? importPage(id, job, Number(n)) : null;
  if (!page) return notFound();
  return new Response(new Uint8Array(page.data), {
    headers: { "Content-Type": page.mimeType, "Cache-Control": "private, max-age=3600" },
  });
}, { global: true });
