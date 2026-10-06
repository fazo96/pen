import { redirect } from "next/navigation";
import GlobalCodex from "@/components/GlobalCodex";
import { aiEnabled } from "@/lib/construct/agents";
import { GLOBAL, listCodex, readSpots } from "@/lib/docs";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The Global Codex: opens the entry viewed last (else the first), or offers to start one. */
export default async function Page() {
  await requirePageSession("/codex");
  const [entries, spots] = await Promise.all([listCodex(GLOBAL), readSpots(GLOBAL)]);
  const list = entries ?? [];
  const open = list.find((e) => e.id === spots.last) ?? list[0];
  if (open) redirect(`/codex/${open.id}`);
  return <GlobalCodex ai={aiEnabled()} />;
}
