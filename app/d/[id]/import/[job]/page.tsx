import { notFound } from "next/navigation";
import ImportNote from "@/components/ImportNote";
import { readDoc } from "@/lib/docs";
import { getImport } from "@/lib/imports";
import { requirePageSession } from "@/lib/session";
import { titleOf } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string; job: string }> }) {
  const { id, job } = await params;
  await requirePageSession(`/d/${id}/import/${job}`);
  const doc = await readDoc(id);
  if (!doc) notFound();
  return <ImportNote key={job} projectId={id} book={titleOf(doc.content, id)} job={getImport(id, job)} jobId={job} />;
}
