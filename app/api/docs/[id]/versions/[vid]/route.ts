import { deleteVersion, readVersion, renameVersion } from "@/lib/docs";
import { badRequest, noContent, notFound, readJson, route } from "@/lib/route";

export const dynamic = "force-dynamic";

type Params = { id: string; vid: string };

export const GET = route<Params>(async (_req, { id, vid }) => {
  const content = await readVersion(id, vid);
  return content === null ? notFound() : Response.json({ id: vid, content });
});

export const DELETE = route<Params>(async (_req, { id, vid }) => ((await deleteVersion(id, vid)) ? noContent() : notFound()));

/** Rename a version (an automatic one becomes named, so it's kept). */
export const PATCH = route<Params>(async (req, { id, vid }) => {
  const label = ((await readJson(req)) as { label?: unknown } | undefined)?.label;
  if (typeof label !== "string") return badRequest("label must be a string");
  const meta = await renameVersion(id, vid, label.trim().slice(0, 120));
  return meta ? Response.json(meta) : notFound();
});
