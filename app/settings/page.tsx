import Settings from "@/components/Settings";
import { isLocked } from "@/lib/auth";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePageSession("/settings");
  return <Settings locked={await isLocked()} />;
}
