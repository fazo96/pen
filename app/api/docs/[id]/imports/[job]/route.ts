import { dropImport, type ImportEvent, watchImport } from "@/lib/imports";
import { ndjsonResponse } from "@/lib/ndjson";
import { fail, noContent, route } from "@/lib/route";

export const dynamic = "force-dynamic";

type Params = { id: string; job: string };

const gone = () => fail(404, "no such import");

/** The last thing a job says: a finished snapshot, its entry or its error. */
const isLast = (e: ImportEvent) => e.t === "entry" || e.t === "error" || (e.t === "state" && e.status !== "running");

/**
 * Follow an import as JSON lines: `{ t: "state" }` with the text so far, then
 * `{ t: "text" }` pieces, ending with `{ t: "entry", id }` or `{ t: "error" }`.
 */
export const GET = route<Params>(async (req, { id, job }) => {
  // Events wait here until the stream starts (the snapshot comes at once).
  const early: ImportEvent[] = [];
  let push = (e: ImportEvent) => void early.push(e);
  const stop = watchImport(id, job, (e) => push(e));
  if (!stop) return gone();
  return ndjsonResponse(
    (send) =>
      new Promise<void>((resolve) => {
        const end = () => {
          stop();
          resolve();
        };
        push = (e) => {
          send(e);
          if (isLast(e)) end();
        };
        for (const e of early) push(e);
        req.signal.addEventListener("abort", end, { once: true });
      }),
  );
});

/** Stop a running import, or forget a finished one. */
export const DELETE = route<Params>(async (_req, { id, job }) => (dropImport(id, job) ? noContent() : gone()));
