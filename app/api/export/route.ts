import { libraryFiles, stamp, zipResponse } from "@/lib/library";
import { hasSession, lockedResponse } from "@/lib/session";
import { zip } from "@/lib/zip";

export const dynamic = "force-dynamic";

/** The whole library as a zip: book folders, trash, shelves. */
export async function GET() {
  if (!(await hasSession())) return lockedResponse();
  return zipResponse(zip(libraryFiles()), `pen-library-${stamp()}.zip`);
}
