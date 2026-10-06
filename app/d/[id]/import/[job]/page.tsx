import { notFound } from "next/navigation";
import ImportNote from "@/components/ImportNote";
import { GLOBAL, readDoc } from "@/lib/docs";
import { getImport } from "@/lib/imports";
import { requirePageSession } from "@/lib/session";
import { titleOf } from "@/lib/text";

export const dynamic = "force-dynamic";

/** A note being transcribed into a book's Codex, or into the Global Codex (id _global). */
export default async function Page({ params }: { params: Promise<{ id: string; job: string }> }) {
  const { id, job } = await params;
  await requirePageSession(`/d/${id}/import/${job}`);
  const doc = id === GLOBAL ? null : await readDoc(id);
  if (id !== GLOBAL && !doc) notFound();
  const book = doc ? titleOf(doc.content, id) : "Global Codex";
  return <ImportNote key={job} projectId={id} book={book} job={getImport(id, job)} jobId={job} />;
}
