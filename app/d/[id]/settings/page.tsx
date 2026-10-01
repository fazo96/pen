import { notFound } from "next/navigation";
import BookSettings from "@/components/BookSettings";
import { listDocs } from "@/lib/docs";
import { requirePageSession } from "@/lib/session";
import { getShelves } from "@/lib/shelves";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageSession(`/d/${id}/settings`);
  const docs = await listDocs();
  const doc = docs.find((d) => d.id === id);
  if (!doc) notFound();
  return <BookSettings key={doc.id} doc={doc} shelves={await getShelves(docs.map((d) => d.id))} />;
}
