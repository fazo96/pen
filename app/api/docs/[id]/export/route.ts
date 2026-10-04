import { readDoc } from "@/lib/docs";
import { bookFiles, stamp, zipResponse } from "@/lib/library";
import { notFound, route } from "@/lib/route";
import { zip } from "@/lib/zip";

export const dynamic = "force-dynamic";

/** One book as a zip: its folder, and what of it is in the trash. */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  if (!(await readDoc(id))) return notFound();
  return zipResponse(zip(bookFiles(id)), `${id}-${stamp()}.zip`);
});
