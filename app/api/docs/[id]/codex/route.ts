import os from "node:os";
import path from "node:path";
import { AGENTS } from "@/lib/construct/agents";
import { critsToMarkdown, isCritiqueCirclePage } from "@/lib/critiquecircle";
import { createEntry, listCodex, MAX_BYTES, readDoc } from "@/lib/docs";
import { hasSession, lockedResponse } from "@/lib/session";
import { titleOf } from "@/lib/text";
import {
  entryFromReply,
  imageTypeOf,
  MAX_PAGE_BYTES,
  MAX_PAGES,
  type Page,
  runTranscription,
  TimeoutError,
  transcribePrompt,
} from "@/lib/transcribe";

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
 * `html`, or from photos of a handwritten note (`images`, base64, in page order).
 */
export async function POST(req: Request, { params }: Ctx) {
  if (!(await hasSession())) return lockedResponse();
  const id = (await params).id;
  const body = (await req.json().catch(() => ({}))) as { content?: unknown; name?: unknown; html?: unknown; images?: unknown };
  let content = typeof body.content === "string" ? body.content : "";
  let name = typeof body.name === "string" ? body.name : undefined;
  if (body.images !== undefined) {
    const read = await transcribe(id, body.images);
    if (read instanceof Response) return read;
    content = read;
  }
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

/** The note in the photos as an entry's markdown, or the error to answer with. */
async function transcribe(id: string, images: unknown): Promise<string | Response> {
  const error = (status: number, message: string) => Response.json({ error: message }, { status });
  if (!Array.isArray(images) || !images.length || images.some((i) => typeof i !== "string")) {
    return error(400, "images must be a list of base64 strings");
  }
  if (images.length > MAX_PAGES) return error(413, `at most ${MAX_PAGES} pictures per note`);
  const pages: Page[] = [];
  for (const data of images as string[]) {
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > MAX_PAGE_BYTES) return error(413, "picture too large (max 5 MB)");
    const mimeType = imageTypeOf(bytes);
    if (!mimeType) return error(415, "pictures must be JPEG, PNG, WebP or GIF");
    pages.push({ data: bytes.toString("base64"), mimeType });
  }
  const [doc, entries] = await Promise.all([readDoc(id), listCodex(id)]);
  if (!doc || !entries) return notFound();
  const preset = AGENTS.claude;
  try {
    const reply = await runTranscription(
      pages,
      transcribePrompt(pages.length, { book: titleOf(doc.content, id), entries: entries.map((e) => e.title) }),
      {
        command: preset.command,
        // Not a project id (those can't start with a dot), so never one of Construct's homes.
        cwd: path.join(os.tmpdir(), "pen-construct", ".transcribe"),
        sessionMeta: preset.sessionMeta("You transcribe photos of a novelist's hard-to-read handwritten notes into markdown, giving your best reading of every word rather than leaving any out.", "pen"),
      },
    );
    return entryFromReply(reply);
  } catch (err) {
    console.error("codex: couldn't transcribe", err);
    const why = err instanceof Error ? err.message : String(err);
    return error(err instanceof TimeoutError ? 504 : 502, `couldn’t transcribe the note: ${why}`);
  }
}
