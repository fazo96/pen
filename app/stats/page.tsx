import WritingPage from "@/components/WritingPage";
import { requirePageSession } from "@/lib/session";
import { recentWriting } from "@/lib/writing";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePageSession("/stats");
  return <WritingPage report={await recentWriting()} />;
}
