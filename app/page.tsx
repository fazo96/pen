import Pen from "@/components/Pen";
import { readStory } from "@/lib/story";

// Always read the file fresh so every device opens the latest version.
export const dynamic = "force-dynamic";

export default async function Page() {
  const story = await readStory();
  return <Pen initial={story} />;
}
