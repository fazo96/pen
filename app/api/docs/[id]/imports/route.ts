import { listImports } from "@/lib/imports";
import { hasSession, lockedResponse } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The book's note imports still running, or finished within the hour (lib/imports.ts). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) return lockedResponse();
  return Response.json(listImports((await params).id), { headers: { "Cache-Control": "no-store" } });
}
