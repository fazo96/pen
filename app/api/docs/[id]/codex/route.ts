import { aiEnabled, aiOffResponse } from "@/lib/construct/agents";
import { askOnce } from "@/lib/construct/ask";
import { critsToMarkdown, isCritiqueCirclePage } from "@/lib/critiquecircle";
import { createEntry, listCodex, MAX_BYTES, readDoc } from "@/lib/docs";
import { startImport } from "@/lib/imports";
import { fail, notFound, noStore, readJson, route } from "@/lib/route";
import { titleOf } from "@/lib/text";
import { entryFromReply, imageTypeOf, MAX_PAGE_BYTES, MAX_PAGES, transcribePrompt } from "@/lib/transcribe";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  const list = await listCodex(id);
  return list ? noStore(list) : notFound();
});

/**
 * Create an entry from markdown `content`, from a saved Critique Circle page's
 * `html`, or from photos of a handwritten note (`images`, base64, in page
 * order). Photos start an import instead (see transcribe below).
 */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const body = ((await readJson(req)) ?? {}) as { content?: unknown; name?: unknown; html?: unknown; images?: unknown };
  if (body.images !== undefined) return transcribe(id, body.images);
  let content = typeof body.content === "string" ? body.content : "";
  let name = typeof body.name === "string" ? body.name : undefined;
  if (typeof body.html === "string") {
    if (Buffer.byteLength(body.html) > MAX_BYTES) return fail(413, "page too large (max 5 MB)");
    if (!isCritiqueCirclePage(body.html)) return fail(422, "not a saved Critique Circle page with crits");
    ({ markdown: content, title: name } = critsToMarkdown(body.html));
  }
  if (Buffer.byteLength(content) > MAX_BYTES) return fail(413, "entry too large (max 5 MB)");
  const entry = await createEntry(id, content, name);
  return entry ? Response.json(entry, { status: 201 }) : notFound();
});

/**
 * The note in the photos as a new entry. Checks answer at once; the reading
 * itself is a job (lib/imports.ts), since a self-hosted model may take
 * minutes: a 202 gives its id, and /api/docs/<id>/imports/<job> follows it.
 * It carries on to the end if the writer closes the page.
 */
async function transcribe(id: string, images: unknown): Promise<Response> {
  if (!aiEnabled()) return aiOffResponse();
  if (!Array.isArray(images) || !images.length || images.some((i) => typeof i !== "string")) {
    return fail(400, "images must be a list of base64 strings");
  }
  if (images.length > MAX_PAGES) return fail(413, `at most ${MAX_PAGES} pictures per note`);
  const pages: { data: Buffer; mimeType: string }[] = [];
  for (const data of images as string[]) {
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > MAX_PAGE_BYTES) return fail(413, "picture too large (max 5 MB)");
    const mimeType = imageTypeOf(bytes);
    if (!mimeType) return fail(415, "pictures must be JPEG, PNG, WebP or GIF");
    pages.push({ data: bytes, mimeType });
  }
  const [doc, entries] = await Promise.all([readDoc(id), listCodex(id)]);
  if (!doc || !entries) return notFound();
  const prompt = transcribePrompt(pages.length, { book: titleOf(doc.content, id), entries: entries.map((e) => e.title) });

  const job = startImport(id, pages, async ({ onText, onThought, signal }) => {
    let reply: string;
    try {
      reply = await askOnce("transcribe", {
        systemPrompt:
          "You transcribe photos of a novelist's hard-to-read handwritten notes into markdown, giving your best reading of every word rather than leaving any out.",
        prompt: [
          ...pages.map((p) => ({ type: "image" as const, data: p.data.toString("base64"), mimeType: p.mimeType })),
          { type: "text", text: prompt },
        ],
        onText,
        onThought,
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      console.error("codex: couldn't transcribe", err);
      throw new Error(`couldn’t transcribe the note: ${err instanceof Error ? err.message : String(err)}`);
    }
    const entry = await createEntry(id, entryFromReply(reply));
    if (!entry) throw new Error("the book is gone");
    return entry.id;
  });
  return Response.json({ job }, { status: 202 });
}
