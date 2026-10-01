import { notFound } from "next/navigation";
import BookSettings from "@/components/BookSettings";
import { listDocs } from "@/lib/docs";
import { bookStats } from "@/lib/library";
import { requirePageSession } from "@/lib/session";
import { getShelves } from "@/lib/shelves";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageSession(`/d/${id}/settings`);
  const docs = await listDocs();
  const doc = docs.find((d) => d.id === id);
  if (!doc) notFound();
  const [shelves, stats] = await Promise.all([getShelves(docs.map((d) => d.id)), bookStats(doc.id, doc.words)]);
  return <BookSettings key={doc.id} doc={doc} shelves={shelves} stats={stats} />;
}
