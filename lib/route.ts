import "server-only";
import { isValidId } from "./ids";
import { hasSession, lockedResponse } from "./session";
import { isValidVersionId } from "./versions";

// What every API route does first, and the answers they share. The proxy is the
// first lock check; `route` is the second, as each handler should have.

type Params = Record<string, string>;

// Route segments that name something on disk; a bad one is a 404 before the
// handler runs. Others (an import's job, a page number) are checked where used.
const CHECKS: Record<string, (value: string) => boolean> = { id: isValidId, eid: isValidId, vid: isValidVersionId };

/** A route handler behind the session check, with its params awaited and the ids among them checked. */
export function route<P extends Params = Params>(fn: (req: Request, params: P) => Promise<Response>) {
  return async (req: Request, ctx?: { params: Promise<P> }): Promise<Response> => {
    if (!(await hasSession())) return lockedResponse();
    const params = ctx?.params ? await ctx.params : ({} as P);
    for (const [key, value] of Object.entries(params)) {
      if (CHECKS[key] && !CHECKS[key](value)) return notFound();
    }
    return fn(req, params);
  };
}

/** The request's JSON body, or undefined if it isn't JSON. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

export const fail = (status: number, error: string) => Response.json({ error }, { status });
export const notFound = () => fail(404, "not found");
export const badRequest = (error: string) => fail(400, error);
export const noContent = () => new Response(null, { status: 204 });
/** JSON the browser must not cache (it changes as the writer works). */
export const noStore = (data: unknown) => Response.json(data, { headers: { "Cache-Control": "no-store" } });
