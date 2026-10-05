import { badRequest, noStore, route } from "@/lib/route";
import { REPORT_DAYS, writingReport } from "@/lib/writing";

export const dynamic = "force-dynamic";

/** The writing stats: `?from=&to=` (ms since the epoch), the last 32 days by default. */
export const GET = route(async (req) => {
  const q = new URL(req.url).searchParams;
  const now = Date.now();
  const to = q.has("to") ? Number(q.get("to")) : now + 60_000;
  const from = q.has("from") ? Number(q.get("from")) : now - REPORT_DAYS * 86_400_000;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return badRequest("from and to: ms since the epoch, from ≤ to");
  return noStore(await writingReport(from, to));
});
