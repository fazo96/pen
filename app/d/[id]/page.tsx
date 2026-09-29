import { notFound } from "next/navigation";
import Pen from "@/components/Pen";
import { readDoc } from "@/lib/docs";
import { requirePageSession } from "@/lib/session";

// Always read the file fresh so every device opens the latest version.
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageSession(`/d/${id}`);
  const doc = await readDoc(id);
  if (!doc) notFound();
  // Keyed so switching documents gets a fresh editor and save state.
  return <Pen key={doc.id} initial={doc} />;
}
