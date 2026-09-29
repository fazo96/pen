import { notFound } from "next/navigation";
import Pen from "@/components/Pen";
import { readDoc, readEntry } from "@/lib/docs";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string; eid: string }> }) {
  const { id, eid } = await params;
  await requirePageSession(`/d/${id}/codex/${eid}`);
  const [project, entry] = await Promise.all([readDoc(id), readEntry(id, eid)]);
  if (!project || !entry) notFound();
  return <Pen key={`${id}/codex/${eid}`} projectId={id} kind="entry" initial={entry} />;
}
