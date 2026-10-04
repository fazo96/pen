import { notFound } from "next/navigation";
import Pen from "@/components/Pen";
import { aiEnabled } from "@/lib/construct/agents";
import { readDoc, readEntry, readSpots } from "@/lib/docs";
import { requirePageSession } from "@/lib/session";
import { titleOf } from "@/lib/text";

// Always read the file fresh so every device opens the latest version.
export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, { entry, cite }] = await Promise.all([params, searchParams]);
  await requirePageSession(`/d/${id}`);
  const [doc, spots] = await Promise.all([readDoc(id), readSpots(id)]);
  if (!doc) notFound();
  // The top bar's switch goes to the Codex entry viewed last.
  const last = spots.last ? await readEntry(id, spots.last) : null;
  // Keyed so switching documents gets a fresh editor and save state.
  return (
    <Pen
      key={doc.id}
      projectId={doc.id}
      ai={aiEnabled()}
      kind="manuscript"
      initial={doc}
      initialEntry={typeof entry === "string" && entry ? entry : undefined}
      initialCite={typeof cite === "string" && cite ? cite : undefined}
      initialSpot={spots.manuscript}
      lastEntry={last ? { id: last.id, title: titleOf(last.content, last.id) } : undefined}
      recentEntries={spots.entries.map(([e]) => e).reverse()}
    />
  );
}
