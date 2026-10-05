import { redirect } from "next/navigation";
import Home from "@/components/Home";
import { listDocs } from "@/lib/docs";
import { requirePageSession } from "@/lib/session";
import { getShelves } from "@/lib/shelves";
import { recentWriting } from "@/lib/writing";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const library = (await searchParams).library !== undefined;
  await requirePageSession(library ? "/?library" : "/");
  const docs = await listDocs();
  // On boot, a library of one opens straight into it. In-app links to the
  // library pass ?library so it stays reachable.
  if (docs.length === 1 && !library) redirect(`/d/${docs[0].id}`);
  const [shelves, writing] = await Promise.all([getShelves(docs.map((d) => d.id)), recentWriting(docs)]);
  return <Home docs={docs} shelves={shelves} writing={writing} />;
}
