import { notFound } from "next/navigation";
import Pen from "@/components/Pen";
import { readDoc } from "@/lib/docs";

// Always read the file fresh so every device opens the latest version.
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const doc = await readDoc((await params).id);
  if (!doc) notFound();
  // Keyed so switching documents gets a fresh editor and save state.
  return <Pen key={doc.id} initial={doc} />;
}
