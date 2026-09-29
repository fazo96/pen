import { redirect } from "next/navigation";
import Unlock from "@/components/Unlock";
import { isLocked, safeNext } from "@/lib/auth";
import { hasSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).next;
  const next = safeNext(typeof raw === "string" ? raw : null);
  // Nothing to unlock, or already unlocked on this device.
  if (!(await isLocked()) || (await hasSession())) redirect(next);
  return <Unlock next={next} />;
}
