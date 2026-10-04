import { notFound } from "next/navigation";
import Pen from "@/components/Pen";
import { aiEnabled } from "@/lib/construct/agents";
import { readDoc, readEntry, readSpots } from "@/lib/docs";
import { entrySpot } from "@/lib/spot";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string; eid: string }> }) {
  const { id, eid } = await params;
  await requirePageSession(`/d/${id}/codex/${eid}`);
  const [project, entry, spots] = await Promise.all([readDoc(id), readEntry(id, eid), readSpots(id)]);
  if (!project || !entry) notFound();
  return (
    <Pen
      key={`${id}/codex/${eid}`}
      projectId={id}
      ai={aiEnabled()}
      kind="entry"
      initial={entry}
      initialSpot={entrySpot(spots, eid)}
      recentEntries={spots.entries.map(([e]) => e).reverse()}
    />
  );
}
