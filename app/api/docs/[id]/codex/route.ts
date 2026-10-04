import { aiEnabled, aiOffResponse } from "@/lib/construct/agents";
import { askOnce } from "@/lib/construct/ask";
import { critsToMarkdown, isCritiqueCirclePage } from "@/lib/critiquecircle";
import { createEntry, listCodex, MAX_BYTES, readDoc } from "@/lib/docs";
import { startImport } from "@/lib/imports";
import { hasSession, lockedResponse } from "@/lib/session";
import { titleOf } from "@/lib/text";
import { entryFromReply, imageTypeOf, MAX_PAGE_BYTES, MAX_PAGES, transcribePrompt } from "@/lib/transcribe";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ error: "not found" }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const list = await listCodex((await params).id);
  return list ? Response.json(list, { headers: { "Cache-Control": "no-store" } }) : notFound();
}

/**
 * Create an entry from markdown `content`, from a saved Critique Circle page's
 * `html`, or from photos of a handwritten note (`images`, base64, in page
 * order). Photos start an import instead (see transcribe below).
 */
export async function POST(req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const id = (await params).id;
  const body = (await req.json().catch(() => ({}))) as { content?: unknown; name?: unknown; html?: unknown; images?: unknown };
  if (body.images !== undefined) return transcribe(id, body.images);
  let content = typeof body.content === "string" ? body.content : "";
  let name = typeof body.name === "string" ? body.name : undefined;
  if (typeof body.html === "string") {
    if (Buffer.byteLength(body.html) > MAX_BYTES) {
      return Response.json({ error: "page too large (max 5 MB)" }, { status: 413 });
    }
    if (!isCritiqueCirclePage(body.html)) {
      return Response.json({ error: "not a saved Critique Circle page with crits" }, { status: 422 });
    }
    ({ markdown: content, title: name } = critsToMarkdown(body.html));
  }
  if (Buffer.byteLength(content) > MAX_BYTES) {
    return Response.json({ error: "entry too large (max 5 MB)" }, { status: 413 });
  }
  const entry = await createEntry(id, content, name);
  return entry ? Response.json(entry, { status: 201 }) : notFound();
}

/**
 * The note in the photos as a new entry. Checks answer at once; the reading
 * itself is a job (lib/imports.ts), since a self-hosted model may take
 * minutes: a 202 gives its id, and /api/docs/<id>/imports/<job> follows it.
 * It carries on to the end if the writer closes the page.
 */
async function transcribe(id: string, images: unknown): Promise<Response> {
  const error = (status: number, message: string) => Response.json({ error: message }, { status });
  if (!aiEnabled()) return aiOffResponse();
  if (!Array.isArray(images) || !images.length || images.some((i) => typeof i !== "string")) {
    return error(400, "images must be a list of base64 strings");
  }
  if (images.length > MAX_PAGES) return error(413, `at most ${MAX_PAGES} pictures per note`);
  const pages: { data: Buffer; mimeType: string }[] = [];
  for (const data of images as string[]) {
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > MAX_PAGE_BYTES) return error(413, "picture too large (max 5 MB)");
    const mimeType = imageTypeOf(bytes);
    if (!mimeType) return error(415, "pictures must be JPEG, PNG, WebP or GIF");
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
