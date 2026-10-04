import { libraryFiles, stamp, zipResponse } from "@/lib/library";
import { route } from "@/lib/route";
import { zip } from "@/lib/zip";

export const dynamic = "force-dynamic";

/** The whole library as a zip: book folders, trash, shelves. */
export const GET = route(async () => zipResponse(zip(libraryFiles()), `pen-library-${stamp()}.zip`));
