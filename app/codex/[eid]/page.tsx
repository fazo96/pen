import { notFound } from "next/navigation";
import Pen from "@/components/Pen";
import { aiEnabled } from "@/lib/construct/agents";
import { GLOBAL, readEntry, readSpots } from "@/lib/docs";
import { entrySpot } from "@/lib/spot";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** An entry of the Global Codex, the notes every book shares: the list on the left, Construct on the right. */
export default async function Page({ params }: { params: Promise<{ eid: string }> }) {
  const { eid } = await params;
  await requirePageSession(`/codex/${eid}`);
  const [entry, spots] = await Promise.all([readEntry(GLOBAL, eid), readSpots(GLOBAL)]);
  if (!entry) notFound();
  return (
    <Pen
      key={`${GLOBAL}/codex/${eid}`}
      projectId={GLOBAL}
      ai={aiEnabled()}
      kind="entry"
      initial={entry}
      initialSpot={entrySpot(spots, eid)}
      recentEntries={spots.entries.map(([e]) => e).reverse()}
    />
  );
}
