import { listImports } from "@/lib/imports";
import { noStore, route } from "@/lib/route";

export const dynamic = "force-dynamic";

/** The book's note imports still running, or finished within the hour (lib/imports.ts). */
export const GET = route<{ id: string }>(async (_req, { id }) => noStore(listImports(id)));
