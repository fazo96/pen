import Settings from "@/components/Settings";
import { isLocked } from "@/lib/auth";
import { AGENTS, availableAgents } from "@/lib/construct/agents";
import { aiSwitchedOff } from "@/lib/construct/detect";
import { libraryStats } from "@/lib/library";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePageSession("/settings");
  const [locked, stats] = await Promise.all([isLocked(), libraryStats()]);
  const agents = availableAgents().map((a) => AGENTS[a].name);
  return <Settings locked={locked} stats={stats} agents={agents} aiSwitchedOff={aiSwitchedOff()} />;
}
