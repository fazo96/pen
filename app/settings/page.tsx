import Settings from "@/components/Settings";
import { isLocked } from "@/lib/auth";
import { libraryStats } from "@/lib/library";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePageSession("/settings");
  const [locked, stats] = await Promise.all([isLocked(), libraryStats()]);
  return <Settings locked={locked} stats={stats} />;
}
