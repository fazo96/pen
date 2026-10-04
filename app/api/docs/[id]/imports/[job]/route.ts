import { dropImport, type ImportEvent, watchImport } from "@/lib/imports";
import { ndjsonResponse } from "@/lib/ndjson";
import { hasSession, lockedResponse } from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; job: string }> };

const gone = () => Response.json({ error: "no such import" }, { status: 404 });

/** The last thing a job says: a finished snapshot, its entry or its error. */
const isLast = (e: ImportEvent) => e.t === "entry" || e.t === "error" || (e.t === "state" && e.status !== "running");

/**
 * Follow an import as JSON lines: `{ t: "state" }` with the text so far, then
 * `{ t: "text" }` pieces, ending with `{ t: "entry", id }` or `{ t: "error" }`.
 */
export async function GET(req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id, job } = await params;
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
}

/** Stop a running import, or forget a finished one. */
export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const { id, job } = await params;
  return dropImport(id, job) ? new Response(null, { status: 204 }) : gone();
}
