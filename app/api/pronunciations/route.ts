import { getPronunciations } from "@/lib/pronunciations";
import { fail, route } from "@/lib/route";

export const dynamic = "force-dynamic";

/**
 * Cadence's pronouncing dictionary, compact (lib/cmudictBuild.ts), gzipped.
 * The browser keeps it and asks again with its ETag on each page load. The
 * first request waits while it's downloaded; 503 if that fails.
 */
export const GET = route(async (req) => {
  try {
    const { gz, etag } = await getPronunciations();
    const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(gz), {
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8", "Content-Encoding": "gzip" },
    });
  } catch (err) {
    return fail(503, (err as Error).message);
  }
});
