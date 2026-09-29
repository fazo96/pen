import { readStory, writeStory } from "@/lib/story";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await readStory(), {
    headers: { "Cache-Control": "no-store" },
  });
}

type SaveBody = { content?: unknown; baseVersion?: unknown; force?: unknown };

async function save(req: Request) {
  let body: SaveBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return Response.json({ error: "content must be a string" }, { status: 400 });
  }
  const base = typeof body.baseVersion === "string" ? body.baseVersion : null;
  const result = await writeStory(body.content, base, body.force === true);
  if (!result.ok) return Response.json(result.current, { status: 409 });
  return Response.json({ version: result.version });
}

export const PUT = save;
// navigator.sendBeacon can only POST; used for the last-chance save on pagehide.
export const POST = save;
